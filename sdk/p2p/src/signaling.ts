/**
 * Signaling transports. Signaling only sets connections up; game data never
 * passes through here.
 *
 *  - `local`: a BroadcastChannel per game between tabs of one browser profile.
 *    No server. The host tab answers join requests itself.
 *  - `hallpass`: the HallPass HTTP endpoints (`/api/v1/p2p/...`), polled. Only
 *    host↔anyone messages are allowed; the room relays guest↔guest signals over
 *    the host's data channels instead.
 *
 * Both expose the same `Signaling` mailbox to the room.
 */

import { connectFailed, P2PError, roomError } from "./errors";
import { env } from "./env";
import { generateCode } from "./codes";
import type { ErrorCode } from "./types";

export interface Signaling {
  /** Any peer may message any peer (local); otherwise only host↔anyone. */
  readonly anyPair: boolean;
  onMessage: (from: string, data: unknown) => void;
  /** The room no longer exists on the signaling side. */
  onLost: () => void;
  send(to: string, data: unknown): void;
  /** Poll fast for a while (a handshake or reconnect is in flight). */
  urgent(ms?: number): void;
  /** Host only: lobby state, so joins to a locked/full room are refused early. */
  setLobby(s: { joinable: boolean; locked: boolean; full: boolean }): void;
  close(bye: boolean): void;
}

export interface Refusal {
  code: ErrorCode;
  hostVersion?: string;
  reason?: string;
}

export interface CreateInfo {
  gameId: string;
  gameVersion: string;
  relayOnly: boolean;
  selfId: string;
  secret: string;
  /** The room's own answer to a join, used by the local transport. */
  precheck: (version: string, from: string) => Refusal | null;
}

export interface JoinInfo {
  gameId: string;
  gameVersion: string;
  selfId: string;
  secret: string;
  name: string;
}

export interface Transport {
  readonly kind: "local" | "hallpass";
  create(info: CreateInfo): Promise<{ sig: Signaling; code: string; relayOnly: boolean }>;
  join(code: string, info: JoinInfo): Promise<{ sig: Signaling; hostId: string; relayOnly: boolean }>;
}

const noop = () => {};

// ── local (BroadcastChannel) ─────────────────────────────────────────────────

interface LocalMsg {
  t: "probe" | "taken" | "join" | "ack" | "sig";
  code: string;
  from?: string;
  to?: string;
  data?: unknown;
  name?: string;
  v?: string;
  ok?: boolean;
  err?: Refusal;
  hostId?: string;
}

class LocalSignaling implements Signaling {
  readonly anyPair = true;
  onMessage: (from: string, data: unknown) => void = noop;
  onLost = noop;
  ack?: (m: LocalMsg) => void;

  constructor(
    private bc: BroadcastChannel,
    private code: string,
    private selfId: string,
    private precheck: ((v: string, from: string) => Refusal | null) | null,
  ) {
    bc.onmessage = (e: MessageEvent) => this.receive(e.data as LocalMsg);
  }

  private post(m: LocalMsg): void {
    try {
      this.bc.postMessage(m);
    } catch {
      // closed
    }
  }

  private receive(m: LocalMsg): void {
    if (!m || m.code !== this.code) return;
    if (m.t === "probe" && this.precheck) this.post({ t: "taken", code: this.code });
    else if (m.t === "join" && this.precheck && m.from) {
      const refusal = this.precheck(m.v ?? "", m.from);
      this.post({ t: "ack", code: this.code, to: m.from, ok: !refusal, err: refusal ?? undefined, hostId: this.selfId });
      if (!refusal) this.onMessage(m.from, { k: "join", name: m.name, v: m.v });
    } else if (m.t === "ack" && m.to === this.selfId) this.ack?.(m);
    else if (m.t === "sig" && m.to === this.selfId && m.from) this.onMessage(m.from, m.data);
  }

  send(to: string, data: unknown): void {
    this.post({ t: "sig", code: this.code, to, from: this.selfId, data });
  }

  joinRequest(info: JoinInfo): void {
    this.post({ t: "join", code: this.code, from: this.selfId, name: info.name, v: info.gameVersion });
  }

  urgent(): void {}
  setLobby(): void {}
  close(): void {
    this.bc.close();
  }
}

function channel(gameId: string): BroadcastChannel {
  if (typeof BroadcastChannel === "undefined") {
    throw new P2PError("unsupported", "This browser can't run the local test transport (no BroadcastChannel).");
  }
  return new BroadcastChannel("hallpass-p2p/" + gameId);
}

export function localTransport(): Transport {
  return {
    kind: "local",
    async create(info) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = generateCode();
        const bc = channel(info.gameId);
        let taken = false;
        bc.onmessage = (e: MessageEvent) => {
          const m = e.data as LocalMsg;
          if (m?.t === "taken" && m.code === code) taken = true;
        };
        bc.postMessage({ t: "probe", code } satisfies LocalMsg);
        await new Promise((r) => setTimeout(r, 120));
        if (taken) {
          bc.close();
          continue;
        }
        return { sig: new LocalSignaling(bc, code, info.selfId, info.precheck), code, relayOnly: false };
      }
      throw connectFailed("signaling-unavailable");
    },
    async join(code, info) {
      const bc = channel(info.gameId);
      const sig = new LocalSignaling(bc, code, info.selfId, null);
      const ack = await new Promise<LocalMsg | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), 1500);
        sig.ack = (m) => {
          clearTimeout(timer);
          resolve(m);
        };
        sig.joinRequest(info);
      });
      sig.ack = undefined;
      if (!ack) {
        sig.close();
        throw roomError("room-not-found", { code });
      }
      if (!ack.ok || !ack.hostId) {
        sig.close();
        const err = ack.err ?? { code: "room-not-found" as ErrorCode };
        throw roomError(err.code, { code, hostVersion: err.hostVersion, mine: info.gameVersion, reason: err.reason });
      }
      return { sig, hostId: ack.hostId, relayOnly: false };
    },
  };
}

// ── hallpass (HTTP polling) ──────────────────────────────────────────────────

interface Reply {
  status: number;
  data?: Record<string, unknown>;
}

export async function call(url: string, body?: unknown, keepalive = false): Promise<Reply> {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 10000);
  try {
    const res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? { Accept: "application/json" } : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      ...(keepalive ? { keepalive: true } : {}),
      signal: ctl?.signal,
    });
    let data: Record<string, unknown> | undefined;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = undefined;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

const FAST_MS = 250;
const LOBBY_MS = 1000;
const HEARTBEAT_MS = 25000;
const BATCH_MS = 30;
const MAX_BATCH = 32;

class HttpSignaling implements Signaling {
  readonly anyPair = false;
  onMessage: (from: string, data: unknown) => void = noop;
  onLost = noop;
  private out: Array<{ to: string; data: unknown }> = [];
  private after = 0;
  private closed = false;
  private urgentUntil = 0;
  private lobby = { joinable: true, locked: false, full: false };
  private wakeFn?: () => void;
  private backoff = 0;

  constructor(
    private url: string,
    private token: string,
    private isHost: boolean,
    private log: (...a: unknown[]) => void,
  ) {
    void this.loop();
  }

  send(to: string, data: unknown): void {
    if (this.closed) return;
    this.out.push({ to, data });
    this.urgent();
  }

  urgent(ms = 15000): void {
    this.urgentUntil = Math.max(this.urgentUntil, env.now() + ms);
    this.wake(BATCH_MS);
  }

  setLobby(s: { joinable: boolean; locked: boolean; full: boolean }): void {
    const changed = s.joinable !== this.lobby.joinable || s.locked !== this.lobby.locked || s.full !== this.lobby.full;
    this.lobby = s;
    // Poll fast for a few seconds: the new state reaches the server on the next
    // poll even if one is in flight now (a locked room otherwise only polls
    // every 25 s), and a join that slipped in before the server knew gets its
    // refusal at once instead of waiting for a heartbeat.
    if (changed) this.urgent(5000);
  }

  close(bye: boolean): void {
    if (this.closed) return;
    this.closed = true;
    this.wakeFn?.();
    if (bye && this.isHost) void call(this.url, { token: this.token, bye: true }, true);
  }

  private interval(): number {
    if (this.out.length) return BATCH_MS;
    if (env.now() < this.urgentUntil) return FAST_MS;
    if (this.isHost) return this.lobby.joinable ? LOBBY_MS : HEARTBEAT_MS;
    return Infinity;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(timer);
        if (this.wakeFn === done) this.wakeFn = undefined;
        resolve();
      };
      if (ms !== Infinity) timer = setTimeout(done, ms);
      this.wakeFn = done;
    });
  }

  private wake(delay: number): void {
    const fn = this.wakeFn;
    if (!fn) return;
    if (delay <= 0) fn();
    else setTimeout(() => this.wakeFn === fn && fn(), delay);
  }

  private async loop(): Promise<void> {
    // The host polls immediately (a join may already be waiting).
    while (!this.closed) {
      await this.tick();
      if (this.closed) break;
      await this.sleep(this.backoff || this.interval());
    }
  }

  private async tick(): Promise<void> {
    const batch = this.out.splice(0, MAX_BATCH);
    const r = await call(this.url, {
      token: this.token,
      after: this.after,
      send: batch,
      state: this.isHost ? { locked: this.lobby.locked, full: this.lobby.full } : undefined,
    });
    if (this.closed) return;
    const d = r.data;
    if (r.status === 200 && d?.ok) {
      this.backoff = 0;
      const messages = Array.isArray(d.messages) ? (d.messages as Array<{ id: number; from: string; data: unknown }>) : [];
      for (const m of messages) {
        if (!(m.id > this.after)) continue;
        this.after = m.id;
        try {
          this.onMessage(m.from, m.data);
        } catch (e) {
          this.log("signal handler failed", e);
        }
      }
      if (messages.length) this.urgent(5000);
      if (d.alive === false) {
        this.closed = true;
        this.onLost();
      }
    } else if (r.status === 401) {
      this.closed = true;
      this.onLost();
    } else if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      this.log("signal batch refused", r.status, d?.error);
    } else {
      this.out.unshift(...batch);
      this.backoff = Math.min(8000, Math.max(500, this.backoff * 2));
    }
  }
}

function httpFailure(r: Reply): P2PError {
  if (r.status === 429) return connectFailed("rate-limited");
  if (r.status === 503) return connectFailed("signaling-unavailable");
  return connectFailed("signaling-unreachable");
}

export function httpTransport(api: string, log: (...a: unknown[]) => void): Transport {
  const base = api.replace(/\/+$/, "") + "/api/v1/p2p/rooms";
  return {
    kind: "hallpass",
    async create(info) {
      const r = await call(base, {
        gameId: info.gameId,
        gameVersion: info.gameVersion,
        secret: info.secret,
        relayOnly: info.relayOnly,
      });
      const d = r.data;
      if (r.status === 404) throw connectFailed("unknown-game");
      if (r.status !== 200 || !d?.ok || typeof d.code !== "string" || typeof d.token !== "string") throw httpFailure(r);
      if (d.peerId !== info.selfId) throw connectFailed("signaling-unavailable");
      const sig = new HttpSignaling(`${base}/${d.code}/signal`, d.token, true, log);
      return { sig, code: d.code, relayOnly: d.relayOnly === true };
    },
    async join(code, info) {
      const r = await call(`${base}/${encodeURIComponent(code)}/join`, {
        gameId: info.gameId,
        gameVersion: info.gameVersion,
        secret: info.secret,
        name: info.name,
      });
      const d = r.data;
      if (r.status === 404) throw roomError("room-not-found", { code });
      if (r.status === 409 && typeof d?.error === "string") {
        throw roomError(d.error as ErrorCode, {
          code,
          hostVersion: typeof d.hostVersion === "string" ? d.hostVersion : undefined,
          mine: info.gameVersion,
        });
      }
      if (r.status !== 200 || !d?.ok || typeof d.token !== "string" || typeof d.hostId !== "string") throw httpFailure(r);
      if (d.peerId !== info.selfId) throw connectFailed("signaling-unavailable");
      const sig = new HttpSignaling(`${base}/${code}/signal`, d.token, false, log);
      sig.urgent(30000);
      return { sig, hostId: d.hostId, relayOnly: d.relayOnly === true };
    },
  };
}

export interface HallPassConfig {
  self: { name: string; avatarUrl: string | null } | null;
  iceServers: RTCIceServer[];
  iceExpiresAt: number | null;
  turn: boolean;
  forceRelay: boolean;
}

/** `GET /api/v1/p2p/config`. `null` when HallPass cannot be reached. */
export async function fetchConfig(api: string, gameId: string): Promise<HallPassConfig | null> {
  const r = await call(`${api.replace(/\/+$/, "")}/api/v1/p2p/config?game=${encodeURIComponent(gameId)}`);
  const d = r.data;
  if (r.status !== 200 || !d?.ok || !Array.isArray(d.iceServers)) return null;
  const self = d.self as HallPassConfig["self"];
  return {
    self: self && typeof self.name === "string" ? { name: self.name, avatarUrl: self.avatarUrl ?? null } : null,
    iceServers: d.iceServers as RTCIceServer[],
    iceExpiresAt: typeof d.iceExpiresAt === "number" ? d.iceExpiresAt : null,
    turn: d.turn === true,
    forceRelay: d.forceRelay === true,
  };
}
