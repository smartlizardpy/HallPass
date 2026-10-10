/**
 * A room: the mesh of peer links, host-authoritative presence, messaging,
 * request/handle, the shared clock and the room's lifecycle.
 *
 * PRESENCE. The host owns the truth (`st`) and broadcasts a full snapshot on
 * every change. Every peer — the host included — applies snapshots through one
 * function that diffs against the last view and raises `player-join`,
 * `player-leave`, `player-update` and `room-update`. Snapshots are small (≤ 8
 * players), and a full snapshot can never be applied out of order.
 *
 * JOINING. The joiner dials the host (via signaling), says `hello`, receives
 * `welcome` (a snapshot plus the peers to dial), dials them through the host's
 * relay, then reports `meshed`. Only then does the host make it a player, so
 * `player-join` fires once the newcomer is reachable by everyone, and
 * `joinRoom()` resolves on the snapshot that lists it.
 *
 * Wire envelopes (see wire.ts): ['m', event, sentAt] user message,
 * ['q', id, event, sentAt] request, ['r', id, ok] response, ['c', kind] control.
 */

import { ClockSync, smooth } from "./clock";
import { MAX_PLAYERS, sanitizeName } from "./codes";
import { Emitter } from "./emitter";
import { env, hasDocument } from "./env";
import { connectFailed, P2PError, roomError } from "./errors";
import { PeerLink, type LinkState, type RtcSignal } from "./peer";
import type { Refusal, Signaling } from "./signaling";
import type {
  CloseReason,
  LeaveReason,
  MessageMeta,
  PeerStats,
  Player,
  PlayerConnection,
  RequestHandler,
  RequestOptions,
  Room,
  SendOptions,
  SimulateOptions,
  StartEvent,
} from "./types";
import { VoiceImpl } from "./voice";
import { MAX_RELIABLE_BYTES, MAX_UNRELIABLE_BYTES, decode, encode, frameSize, type Frame, type Header } from "./wire";

const RESERVED = new Set([
  "player-join",
  "player-leave",
  "player-update",
  "room-update",
  "start",
  "host-left",
  "kicked",
  "closed",
  "visibility",
  "error",
]);

const DROP_AFTER_MS = 10_000;
const PENDING_TIMEOUT_MS = 30_000;
const START_LEAD_MS = 500;
const PING_EVERY_MS = 2000;
const MAX_PLAYER_META = 4096;
const MAX_ROOM_META = 8192;

interface PState {
  id: string;
  name: string;
  avatarUrl: string | null;
  ready: boolean;
  meta: Record<string, unknown>;
  hidden: boolean;
}

interface Snap {
  rev: number;
  host: string;
  meta: Record<string, unknown>;
  locked: boolean;
  started: boolean;
  max: number;
  players: PState[];
  pending: string[];
  start: StartEvent | null;
  left?: Array<[string, LeaveReason]>;
}

export interface RoomDeps {
  code: string;
  selfId: string;
  hostId: string;
  isHost: boolean;
  self: { name: string; avatarUrl: string | null };
  gameVersion: string;
  rtc: () => RTCConfiguration;
  simulate: SimulateOptions | null;
  log: (...a: unknown[]) => void;
  onClosed: () => void;
  /** Whether TURN was available, for explaining a failed connection. */
  turn: boolean;
  relayOnly: boolean;
}

const clone = <T>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T));
const jsonSize = (v: unknown): number => JSON.stringify(v ?? null).length;
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

export class RoomImpl implements Room {
  readonly code: string;
  readonly selfId: string;
  readonly isHost: boolean;
  hostId: string;
  readonly voice: VoiceImpl;
  closed = false;

  sig!: Signaling;
  private ev: Emitter;
  readonly links = new Map<string, PeerLink>();
  /** Last applied snapshot (what `players`, `meta`... read). */
  private view: Snap;
  /** Host only: the authoritative state snapshots are made from. */
  private st: Snap;
  private lockOnStart = false;

  // host-only bookkeeping
  private pendingJoins = new Map<string, { name: string; avatarUrl: string | null; hello: boolean; welcomed: boolean; timer: ReturnType<typeof setTimeout> }>();
  private kicked = new Set<string>();
  private byes = new Set<string>();
  private early = new Map<string, unknown[]>();

  // joiner-only
  private phase: "joining" | "joined" = "joined";
  private dial = new Set<string>();
  private welcomed = false;
  private meshedSent = false;
  private held: Array<() => void> = [];
  private joinWaiter?: { resolve: (r: RoomImpl) => void; reject: (e: Error) => void };

  // timers, clock, requests
  private dropTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pingTimer?: ReturnType<typeof setInterval>;
  private pings = new Map<string, Array<{ t0: number; ok: boolean }>>();
  private rtt = new Map<string, number>();
  private clock = new ClockSync();
  private lastNow = 0;
  private reqSeq = 0;
  private reqs = new Map<number, { to: string; resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private handlers = new Map<string, RequestHandler>();
  private hidden = false;
  private unlisten: Array<() => void> = [];

  constructor(private d: RoomDeps) {
    this.code = d.code;
    this.selfId = d.selfId;
    this.hostId = d.hostId;
    this.isHost = d.isHost;
    this.ev = new Emitter((err, event) => {
      if (event === "error") return console.error("[hallpass-p2p] an 'error' handler threw:", err);
      // A game handler threw. Report it as a P2PError, keeping the original as `cause`.
      const e = new P2PError("handler-error", `A "${event}" handler threw: ${err instanceof Error ? err.message : String(err)}`);
      (e as P2PError & { cause?: unknown }).cause = err;
      this.ev.emit("error", e);
    });
    const empty: Snap = { rev: 0, host: d.hostId, meta: {}, locked: false, started: false, max: 4, players: [], pending: [], start: null };
    this.view = empty;
    this.st = clone(empty);
    this.voice = new VoiceImpl(this, d.log);
    if (hasDocument()) {
      this.hidden = document.visibilityState === "hidden";
      const onVis = () => this.setHidden(document.visibilityState === "hidden");
      const onHide = () => this.pageGone();
      document.addEventListener("visibilitychange", onVis);
      addEventListener("pagehide", onHide);
      this.unlisten.push(
        () => document.removeEventListener("visibilitychange", onVis),
        () => removeEventListener("pagehide", onHide),
      );
    }
  }

  // ── public getters ─────────────────────────────────────────────────────────

  get meta(): Record<string, unknown> {
    return clone(this.view.meta);
  }
  get locked(): boolean {
    return this.view.locked;
  }
  get started(): boolean {
    return this.view.started;
  }
  get maxPlayers(): number {
    return this.view.max;
  }
  get players(): Player[] {
    return this.view.players.map((p) => this.toPlayer(p));
  }

  // ── lobby ──────────────────────────────────────────────────────────────────

  setReady(ready: boolean): void {
    this.mine({ ready: !!ready });
  }

  setPlayerMeta(meta: Record<string, unknown>): void {
    if (!isObj(meta)) throw new P2PError("invalid-argument", "Player meta must be a plain object.");
    this.mine({ meta: clone(meta) });
  }

  setRoomMeta(meta: Record<string, unknown>): void {
    this.hostOnly("change the room settings");
    if (!isObj(meta)) throw new P2PError("invalid-argument", "Room meta must be a plain object.");
    const next = mergeMeta(this.st.meta, clone(meta));
    if (jsonSize(next) > MAX_ROOM_META) throw new P2PError("invalid-argument", "Room meta is too large (8 KB max).");
    this.st.meta = next;
    this.commit();
  }

  lock(): void {
    this.hostOnly("lock the room");
    this.st.locked = true;
    this.commit();
  }

  unlock(): void {
    this.hostOnly("unlock the room");
    this.st.locked = false;
    this.commit();
  }

  kick(peerId: string, reason = ""): void {
    this.hostOnly("remove players");
    if (peerId === this.selfId || !this.st.players.some((p) => p.id === peerId)) return;
    const why = typeof reason === "string" ? reason.slice(0, 200) : "";
    this.kicked.add(peerId);
    this.ctl(peerId, "kick", { reason: why });
    this.removePlayer(peerId, "kicked");
  }

  start(payload?: unknown): void {
    this.hostOnly("start the game");
    encode(["c", "start"], payload); // throws if not JSON-serialisable
    const ev: StartEvent = { payload: clone(payload), startAt: this.now() + START_LEAD_MS };
    this.st.started = true;
    this.st.start = ev;
    if (this.lockOnStart) {
      this.st.locked = true;
      // Joiners still mid-handshake would enter a started game: turn them away.
      for (const id of [...this.pendingJoins.keys()]) {
        this.ctl(id, "reject", { code: "room-locked" } satisfies Refusal);
        this.dropPending(id);
      }
    }
    for (const p of this.st.players) if (p.id !== this.selfId) this.ctl(p.id, "start", ev);
    this.ev.emit("start", clone(ev));
    this.commit();
  }

  // ── messages ───────────────────────────────────────────────────────────────

  send(event: string, data?: unknown, opts: SendOptions = {}): void {
    this.alive();
    if (typeof event !== "string" || !event || event.length > 64) {
      throw new P2PError("invalid-argument", "Message names must be 1–64 characters.");
    }
    if (RESERVED.has(event)) throw new P2PError("invalid-argument", `"${event}" is a room event name; pick another message name.`);
    const reliable = opts.reliable !== false;
    const frame = encode(["m", event, this.now()], data);
    const size = frameSize(frame);
    if (size > (reliable ? MAX_RELIABLE_BYTES : MAX_UNRELIABLE_BYTES)) {
      throw new P2PError(
        "message-too-large",
        `This message is ${Math.ceil(size / 1024)} KB; the limit is ${reliable ? 256 : 16} KB for ${reliable ? "reliable" : "unreliable"} messages.`,
      );
    }
    const { peers, self } = this.targets(opts.to ?? "others");
    for (const id of peers) this.links.get(id)?.send(frame, reliable);
    if (self) this.deliverLocal(frame, reliable);
  }

  on(event: string, cb: (...args: never[]) => void): () => void {
    const off = this.ev.on(event, cb as (...a: unknown[]) => void);
    return off;
  }

  off(event: string, cb: (...args: never[]) => void): void {
    this.ev.off(event, cb as (...a: unknown[]) => void);
  }

  handle<T = unknown, R = unknown>(event: string, handler: RequestHandler<T, R>): () => void {
    if (typeof handler !== "function") throw new P2PError("invalid-argument", "handle() needs a function.");
    this.handlers.set(event, handler as RequestHandler);
    return () => {
      if (this.handlers.get(event) === handler) this.handlers.delete(event);
    };
  }

  request<R = unknown>(to: string, event: string, data?: unknown, opts: RequestOptions = {}): Promise<R> {
    if (this.closed) return Promise.reject(new P2PError("closed", "You're no longer in this room."));
    const target = to === "host" ? this.hostId : to;
    const timeoutMs = Math.max(1, opts.timeoutMs ?? 5000);
    if (target !== this.selfId && !this.view.players.some((p) => p.id === target)) {
      return Promise.reject(new P2PError("peer-left", "That player isn't in the room."));
    }
    const id = ++this.reqSeq;
    let frame: Frame;
    try {
      frame = encode(["q", id, event, this.now()], data);
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise<R>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.reqs.delete(id);
        reject(new P2PError("timeout", `No answer to "${event}" within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.reqs.set(id, { to: target, resolve: resolve as (v: unknown) => void, reject, timer });
      if (target === this.selfId) queueMicrotask(() => this.onFrame(this.selfId, frame, true));
      else this.links.get(target)?.send(frame, true);
    });
  }

  // ── clock & diagnostics ────────────────────────────────────────────────────

  now(): number {
    const t = env.now();
    if (this.isHost) return t;
    const v = t + (this.clock.offset() ?? 0);
    if (v < this.lastNow) return this.lastNow;
    this.lastNow = v;
    return v;
  }

  async stats(): Promise<Record<string, PeerStats>> {
    const out: Record<string, PeerStats> = {};
    for (const p of this.view.players) {
      const link = this.links.get(p.id);
      if (!link) continue;
      const s = await link.stats();
      out[p.id] = { rttMs: this.rtt.get(p.id) ?? s.rttMs, lossPct: this.loss(p.id), bytesIn: s.bytesIn, bytesOut: s.bytesOut, relay: s.relay };
    }
    return out;
  }

  async leave(): Promise<void> {
    if (this.closed) return;
    for (const l of this.links.values()) this.sendCtl(l, "bye", this.isHost ? { host: true } : null);
    await new Promise((r) => setTimeout(r, 150));
    this.finish("left", true);
  }

  // ── internals: setup ──────────────────────────────────────────────────────

  /** Host: initial state, then publish. */
  hostInit(sig: Signaling, opts: { max: number; meta: Record<string, unknown>; lockOnStart: boolean }): void {
    this.attach(sig);
    this.lockOnStart = opts.lockOnStart;
    this.st = {
      rev: 0,
      host: this.selfId,
      meta: opts.meta,
      locked: false,
      started: false,
      max: opts.max,
      players: [{ id: this.selfId, ...this.d.self, ready: false, meta: {}, hidden: this.hidden }],
      pending: [],
      start: null,
    };
    this.view = clone(this.st);
    this.commit(undefined, true);
    this.startPings();
  }

  /** Joiner: dial the host and wait to be admitted. */
  joinFlow(sig: Signaling, timeoutMs: number): Promise<RoomImpl> {
    this.attach(sig);
    this.phase = "joining";
    this.startPings();
    return new Promise<RoomImpl>((resolve, reject) => {
      const timer = setTimeout(() => this.failJoin(this.classifyJoinFailure()), timeoutMs);
      this.joinWaiter = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      };
      this.makeLink(this.hostId, true);
      sig.urgent(timeoutMs);
    });
  }

  /** The room's own answer to a join request (used by the local transport). */
  precheck(version: string, from: string): Refusal | null {
    if (this.closed) return { code: "room-not-found" };
    if (this.kicked.has(from)) return { code: "room-locked", reason: "kicked" };
    if (version !== this.d.gameVersion) return { code: "version-mismatch", hostVersion: this.d.gameVersion };
    if (this.st.locked || (this.st.started && this.lockOnStart)) return { code: "room-locked" };
    if (this.pendingJoins.has(from) || this.st.players.some((p) => p.id === from)) return null;
    if (this.st.players.length + this.pendingJoins.size >= this.st.max) return { code: "room-full" };
    return null;
  }

  private attach(sig: Signaling): void {
    this.sig = sig;
    sig.onMessage = (from, data) => this.onSignal(from, data);
    sig.onLost = () => {
      if (this.phase === "joining") this.failJoin(connectFailed("room-closed"));
      else if (this.isHost) this.ev.emit("error", connectFailed("registration-lost"));
    };
  }

  // ── internals: links & routing ─────────────────────────────────────────────

  private makeLink(id: string, initiator: boolean): PeerLink {
    const existing = this.links.get(id);
    if (existing) return existing;
    // The joiner (initiator) is impolite; the side that was already there yields.
    const link = new PeerLink(id, !initiator, initiator, this.d.rtc(), this.d.simulate, {
      signal: (data) => this.route(id, data),
      frame: (f, reliable) => this.onFrame(id, f, reliable),
      state: (s) => this.onLinkState(link, s),
      track: (e) => this.voice.onTrack(id, e),
      log: this.d.log,
    });
    this.links.set(id, link);
    const early = this.early.get(id);
    if (early) {
      this.early.delete(id);
      for (const s of early) link.signal(s as RtcSignal);
    }
    return link;
  }

  /** Get a signaling message to `to` by the best path available. */
  private route(to: string, data: unknown): void {
    if (this.closed) return;
    const direct = this.links.get(to);
    if (direct?.open) return this.sendCtl(direct, "sig", { data });
    const hostLink = this.links.get(this.hostId);
    if (!this.isHost && to !== this.hostId) {
      if (hostLink?.open) return this.sendCtl(hostLink, "relay", { to, data });
      if (!this.sig.anyPair) return; // retried by the next ICE restart
    }
    this.sig.send(to, data);
  }

  private onSignal(from: string, data: unknown): void {
    if (this.closed || !isObj(data)) return;
    switch (data.k) {
      case "fwd":
        if (from === this.hostId && typeof data.from === "string") this.onSignal(data.from, data.data);
        return;
      case "join":
        if (this.isHost) this.onJoin(from, data);
        return;
      case "reject":
        if (from === this.hostId && this.phase === "joining") this.failJoin(this.refusal(data as unknown as Refusal));
        return;
      case "rtc":
        return this.onRtc(from, data as unknown as RtcSignal);
    }
  }

  private onRtc(from: string, s: RtcSignal): void {
    let link = this.links.get(from);
    if (!link) {
      const allowed = this.isHost ? this.pendingJoins.has(from) : s.d?.type === "offer" && from !== this.hostId;
      if (!allowed) {
        // A signal can overtake the join it belongs to; keep it briefly.
        const q = this.early.get(from) ?? [];
        if (q.length < 50) q.push(s);
        this.early.set(from, q);
        setTimeout(() => this.early.delete(from), 10_000);
        return;
      }
      link = this.makeLink(from, false);
    }
    link.signal(s);
  }

  private onLinkState(link: PeerLink, s: LinkState): void {
    const id = link.id;
    if (this.links.get(id) !== link) return;
    if (s === "open") {
      this.clearDrop(id);
      this.burstPing(id);
      void this.refreshRelay(id);
      this.voice.linkOpen(link);
      if (!this.isHost && id === this.hostId && this.phase === "joining") {
        this.sendCtl(link, "hello", { name: this.d.self.name, avatarUrl: this.d.self.avatarUrl, v: this.d.gameVersion });
      }
      if (this.isHost) this.maybeWelcome(id);
      this.checkMeshed();
      this.connChanged(id);
    } else if (s === "disrupted") {
      this.connChanged(id);
      // Restart offers/answers may have to travel through the signaling server.
      this.sig.urgent(DROP_AFTER_MS + 5000);
      if (this.isHost) this.dropLater(id, () => this.removePlayer(id, "timeout"));
      else if (id === this.hostId) this.dropLater(id, () => this.hostGone("timeout"));
    } else if (s === "connecting") {
      // ICE failed before ever connecting.
      if (link.failed && this.phase === "joining") this.failJoin(this.classifyJoinFailure());
    } else if (s === "closed") {
      this.links.delete(id);
      this.clearDrop(id);
      this.voice.detach(id);
      if (this.closed) return;
      if (this.isHost) {
        if (this.pendingJoins.has(id)) this.dropPending(id);
        else this.removePlayer(id, this.byes.has(id) ? "left" : "disconnected");
      } else if (id === this.hostId) {
        if (this.phase === "joining") this.failJoin(connectFailed("room-closed"));
        else this.hostGone("host-left");
      } else this.connChanged(id);
    }
  }

  private dropLater(id: string, fn: () => void): void {
    if (this.dropTimers.has(id)) return;
    this.dropTimers.set(
      id,
      setTimeout(() => {
        this.dropTimers.delete(id);
        if (!this.closed && !this.links.get(id)?.open) fn();
      }, DROP_AFTER_MS),
    );
  }

  private clearDrop(id: string): void {
    clearTimeout(this.dropTimers.get(id));
    this.dropTimers.delete(id);
  }

  // ── internals: frames ──────────────────────────────────────────────────────

  private sendCtl(link: PeerLink, kind: string, body: unknown, reliable = true): void {
    try {
      link.send(encode(["c", kind], body), reliable);
    } catch (e) {
      this.d.log("control send failed", kind, e);
    }
  }

  private ctl(id: string, kind: string, body: unknown): void {
    const link = this.links.get(id);
    if (link) this.sendCtl(link, kind, body);
  }

  private onFrame(from: string, raw: string | ArrayBuffer | Uint8Array, reliable: boolean): void {
    if (this.closed) return;
    const msg = decode(raw);
    if (!msg) return;
    const h = msg.header;
    if (h[0] === "c") return this.onControl(from, String(h[1]), msg.body);
    if (this.phase === "joining") {
      // The game has no room object yet; keep user traffic for after joinRoom resolves.
      if (this.held.length < 1000) this.held.push(() => this.onUserFrame(from, h, msg.body, reliable));
      return;
    }
    this.onUserFrame(from, h, msg.body, reliable);
  }

  private onUserFrame(from: string, h: Header, body: unknown, reliable: boolean): void {
    if (h[0] === "m") {
      const event = String(h[1]);
      if (RESERVED.has(event)) return;
      this.ev.emit(event, body, { from, sentAt: Number(h[2]), reliable } satisfies MessageMeta);
    } else if (h[0] === "q") this.onRequest(from, Number(h[1]), String(h[2]), Number(h[3]), body);
    else if (h[0] === "r") {
      const pending = this.reqs.get(Number(h[1]));
      if (!pending || pending.to !== from) return;
      this.reqs.delete(Number(h[1]));
      clearTimeout(pending.timer);
      if (h[2]) pending.resolve(body);
      else pending.reject(new P2PError("handler-error", typeof body === "string" && body ? body : "The request failed."));
    }
  }

  private onRequest(from: string, id: number, event: string, sentAt: number, body: unknown): void {
    const handler = this.handlers.get(event);
    if (!handler) {
      this.d.log(`request "${event}" from ${from} has no handler (the caller will time out)`);
      return;
    }
    const reply = (ok: boolean, value: unknown) => {
      let frame: Frame;
      try {
        frame = encode(["r", id, ok], value);
      } catch {
        frame = encode(["r", id, false], "The answer could not be sent (not JSON-serialisable).");
      }
      if (from === this.selfId) queueMicrotask(() => this.onFrame(this.selfId, frame, true));
      else this.links.get(from)?.send(frame, true);
    };
    Promise.resolve()
      .then(() => handler(body, { from, sentAt, reliable: true }))
      .then(
        (v) => reply(true, v),
        (e: unknown) => reply(false, e instanceof Error ? e.message : String(e ?? "The request failed.")),
      );
  }

  private deliverLocal(frame: Frame, reliable: boolean): void {
    const msg = decode(frame);
    if (msg) this.ev.emit(String(msg.header[1]), msg.body, { from: this.selfId, sentAt: Number(msg.header[2]), reliable });
  }

  private targets(to: SendOptions["to"]): { peers: string[]; self: boolean } {
    const others = this.view.players.map((p) => p.id).filter((id) => id !== this.selfId);
    if (to === "others") return { peers: others, self: false };
    if (to === "all") return { peers: others, self: true };
    const list = to === "host" ? [this.hostId] : Array.isArray(to) ? to : [to as string];
    return { peers: list.filter((id) => id !== this.selfId), self: list.includes(this.selfId) };
  }

  // ── internals: control messages ────────────────────────────────────────────

  private onControl(from: string, kind: string, body: unknown): void {
    const fromHost = from === this.hostId;
    switch (kind) {
      case "ping": {
        const link = this.links.get(from);
        if (link) this.sendCtl(link, "pong", [body, env.now()], false);
        return;
      }
      case "pong":
        return this.onPong(from, body);
      case "sig": {
        if (!isObj(body)) return;
        const origin = fromHost && typeof body.from === "string" ? body.from : from;
        return this.onSignal(origin, body.data);
      }
      case "relay": {
        if (!this.isHost || !isObj(body) || typeof body.to !== "string") return;
        const target = body.to;
        if (!this.pendingJoins.has(target) && !this.st.players.some((p) => p.id === target)) return;
        const link = this.links.get(target);
        if (link?.open) this.sendCtl(link, "sig", { from, data: body.data });
        else {
          this.sig.send(target, { k: "fwd", from, data: body.data });
          this.sig.urgent();
        }
        return;
      }
      case "hello": {
        const p = this.pendingJoins.get(from);
        if (!this.isHost || !p || !isObj(body)) return;
        p.name = sanitizeName(body.name, p.name);
        p.avatarUrl = typeof body.avatarUrl === "string" && /^https:\/\//.test(body.avatarUrl) ? body.avatarUrl.slice(0, 500) : null;
        p.hello = true;
        return this.maybeWelcome(from);
      }
      case "welcome":
        if (fromHost && this.phase === "joining" && isObj(body)) return this.onWelcome(body as { snap: Snap; dial: string[] });
        return;
      case "meshed":
        if (this.isHost) this.admit(from);
        return;
      case "snap":
        if (fromHost && isObj(body)) this.applySnap(body as unknown as Snap);
        return;
      case "set":
        if (this.isHost && isObj(body)) this.onSet(from, body);
        return;
      case "start":
        if (fromHost && this.phase === "joined") this.ev.emit("start", body);
        return;
      case "kick":
        if (fromHost && !this.isHost) {
          this.ev.emit("kicked", { reason: isObj(body) && typeof body.reason === "string" ? body.reason : "" });
          this.finish("kicked", false);
        }
        return;
      case "reject":
        if (fromHost && this.phase === "joining") this.failJoin(this.refusal(body as Refusal));
        return;
      case "bye":
        this.byes.add(from);
        if (fromHost && !this.isHost) this.hostGone("host-left");
        else if (this.isHost) {
          if (this.pendingJoins.has(from)) this.dropPending(from);
          else this.removePlayer(from, "left");
        }
        return;
      case "vis": {
        const hidden = body === true;
        for (const s of this.isHost ? [this.st, this.view] : [this.view]) {
          const p = s.players.find((x) => x.id === from);
          if (p) p.hidden = hidden;
        }
        if (this.phase === "joined") this.ev.emit("visibility", { id: from, hidden });
        return;
      }
      case "voice":
        return this.voice.remoteFlag(from, body === true);
    }
  }

  // ── internals: host side ───────────────────────────────────────────────────

  private onJoin(from: string, data: Record<string, unknown>): void {
    if (this.st.players.some((p) => p.id === from) || this.pendingJoins.has(from)) return;
    const refusal = this.precheck(typeof data.v === "string" ? data.v : "", from);
    if (refusal) {
      this.sig.send(from, { k: "reject", ...refusal });
      return;
    }
    this.pendingJoins.set(from, {
      name: sanitizeName(data.name),
      avatarUrl: null,
      hello: false,
      welcomed: false,
      timer: setTimeout(() => {
        if (this.pendingJoins.has(from)) {
          this.d.log("join timed out", from);
          this.dropPending(from);
        }
      }, PENDING_TIMEOUT_MS),
    });
    this.makeLink(from, false);
    this.sig.urgent();
    this.commit();
  }

  private maybeWelcome(id: string): void {
    const p = this.pendingJoins.get(id);
    const link = this.links.get(id);
    if (!p || p.welcomed || !p.hello || !link?.open) return;
    p.welcomed = true;
    // The newcomer dials everyone already here, and every joiner accepted before it.
    const dial = [...this.st.players.map((x) => x.id), ...this.pendingJoins.keys()].filter(
      (x) => x !== id && x !== this.selfId,
    );
    this.sendCtl(link, "welcome", { snap: this.snapshot(), dial });
  }

  private admit(id: string): void {
    const p = this.pendingJoins.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingJoins.delete(id);
    if (this.st.players.length >= this.st.max) {
      this.ctl(id, "reject", { code: "room-full" } satisfies Refusal);
      this.links.get(id)?.closeSoon();
      this.commit();
      return;
    }
    this.st.players.push({ id, name: p.name, avatarUrl: p.avatarUrl, ready: false, meta: {}, hidden: false });
    this.commit();
  }

  private dropPending(id: string): void {
    const p = this.pendingJoins.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingJoins.delete(id);
    this.links.get(id)?.closeSoon();
    this.commit();
  }

  private removePlayer(id: string, reason: LeaveReason): void {
    const i = this.st.players.findIndex((p) => p.id === id);
    if (i >= 0) {
      this.st.players.splice(i, 1);
      this.commit([[id, reason]]);
    }
    const link = this.links.get(id);
    if (link && reason === "kicked") link.closeSoon();
    else link?.close();
  }

  private onSet(from: string, body: Record<string, unknown>): void {
    const p = this.st.players.find((x) => x.id === from);
    if (!p) return;
    if (typeof body.ready === "boolean") p.ready = body.ready;
    if (isObj(body.meta)) {
      const next = mergeMeta(p.meta, body.meta);
      if (jsonSize(next) <= MAX_PLAYER_META) p.meta = next;
    }
    this.commit();
  }

  private snapshot(left?: Array<[string, LeaveReason]>): Snap {
    const s = clone(this.st);
    s.host = this.selfId;
    s.pending = [...this.pendingJoins.keys()];
    if (left) s.left = left;
    return s;
  }

  /** Host: publish the current state to everyone, and apply it locally. */
  private commit(left?: Array<[string, LeaveReason]>, silent = false): void {
    if (!this.isHost || this.closed) return;
    this.st.rev++;
    const snap = this.snapshot(left);
    this.applySnap(snap, silent);
    for (const link of this.links.values()) if (link.open) this.sendCtl(link, "snap", snap);
    const full = this.st.players.length + this.pendingJoins.size >= this.st.max;
    const locked = this.st.locked || (this.st.started && this.lockOnStart);
    this.sig?.setLobby({ joinable: !locked && !full, locked, full });
  }

  // ── internals: every peer ──────────────────────────────────────────────────

  /** Optimistically apply my own ready/meta change, and tell the host. */
  private mine(change: { ready?: boolean; meta?: Record<string, unknown> }): void {
    this.alive();
    const me = (this.isHost ? this.st : this.view).players.find((p) => p.id === this.selfId);
    if (!me) return;
    const meta = change.meta ? mergeMeta(me.meta, change.meta) : me.meta;
    if (jsonSize(meta) > MAX_PLAYER_META) throw new P2PError("invalid-argument", "Player meta is too large (4 KB max).");
    if (this.isHost) {
      if (change.ready !== undefined) me.ready = change.ready;
      me.meta = meta;
      this.commit();
      return;
    }
    if (change.ready !== undefined) me.ready = change.ready;
    me.meta = meta;
    this.ev.emit("player-update", this.toPlayer(me));
    this.ctl(this.hostId, "set", change);
  }

  private applySnap(snap: Snap, silent = this.phase === "joining"): void {
    if (!Array.isArray(snap.players)) return;
    if (!this.isHost && snap.rev <= this.view.rev && this.phase === "joined") return;
    const prev = this.view;
    this.view = snap;
    this.hostId = snap.host;
    const ids = new Set(snap.players.map((p) => p.id));
    const keep = new Set([...ids, ...(snap.pending ?? []), snap.host]);
    for (const [id, link] of this.links) if (!keep.has(id)) link.close();
    for (const [id, r] of this.reqs) {
      if (r.to !== this.selfId && !ids.has(r.to)) {
        this.reqs.delete(id);
        clearTimeout(r.timer);
        r.reject(new P2PError("peer-left", "That player left before answering."));
      }
    }

    if (!this.isHost && this.phase === "joining") {
      if (ids.has(this.selfId)) return this.joined();
      return this.checkMeshed();
    }
    if (!this.isHost && !ids.has(this.selfId)) {
      // The host dropped us (we were unreachable for too long).
      const why = snap.left?.find(([id]) => id === this.selfId)?.[1];
      if (why === "kicked") this.ev.emit("kicked", { reason: "" });
      return this.finish(why === "kicked" ? "kicked" : "timeout", false);
    }
    if (silent) return;

    const before = new Map(prev.players.map((p) => [p.id, p]));
    const left = new Map(snap.left ?? []);
    for (const p of snap.players) {
      const old = before.get(p.id);
      if (!old) {
        if (p.id !== this.selfId) this.ev.emit("player-join", this.toPlayer(p));
      } else if (
        old.ready !== p.ready ||
        old.name !== p.name ||
        old.avatarUrl !== p.avatarUrl ||
        JSON.stringify(old.meta) !== JSON.stringify(p.meta)
      ) {
        this.ev.emit("player-update", this.toPlayer(p));
      }
    }
    for (const id of before.keys()) {
      if (!ids.has(id)) this.ev.emit("player-leave", { id, reason: left.get(id) ?? "left" });
    }
    if (
      prev.locked !== snap.locked ||
      prev.started !== snap.started ||
      prev.max !== snap.max ||
      JSON.stringify(prev.meta) !== JSON.stringify(snap.meta)
    ) {
      this.ev.emit("room-update", this);
    }
  }

  private onWelcome({ snap, dial }: { snap: Snap; dial: string[] }): void {
    if (this.welcomed) return;
    this.applySnap(snap, true);
    // Mark welcomed only once the dial list is known, or checkMeshed would see
    // an empty list and report "meshed" before a single peer was dialled.
    for (const id of Array.isArray(dial) ? dial : []) {
      if (typeof id !== "string" || id === this.selfId || id === this.hostId) continue;
      this.dial.add(id);
      this.makeLink(id, true);
    }
    this.welcomed = true;
    this.checkMeshed();
  }

  private checkMeshed(): void {
    if (this.isHost || this.phase !== "joining" || !this.welcomed || this.meshedSent) return;
    const present = new Set([...this.view.players.map((p) => p.id), ...(this.view.pending ?? [])]);
    for (const id of [...this.dial]) {
      if (!present.has(id)) {
        this.dial.delete(id);
        continue;
      }
      if (!this.links.get(id)?.open) return;
    }
    const host = this.links.get(this.hostId);
    if (!host?.open) return;
    this.meshedSent = true;
    this.sendCtl(host, "meshed", null);
  }

  private joined(): void {
    this.phase = "joined";
    const waiter = this.joinWaiter;
    this.joinWaiter = undefined;
    waiter?.resolve(this);
    // Deliver after the game's `await joinRoom()` continuation has attached handlers.
    setTimeout(() => {
      if (this.closed) return;
      if (this.view.started && this.view.start) this.ev.emit("start", clone(this.view.start));
      for (const f of this.held.splice(0)) f();
    }, 0);
  }

  private failJoin(err: Error): void {
    if (this.phase !== "joining" || this.closed) return;
    const waiter = this.joinWaiter;
    this.joinWaiter = undefined;
    for (const l of this.links.values()) this.sendCtl(l, "bye", null);
    this.finish("error", true, true);
    waiter?.reject(err);
  }

  private classifyJoinFailure(): Error {
    const host = this.links.get(this.hostId);
    if (!host || (!host.negotiated && !host.failed)) return roomError("timeout");
    if (!host.open) {
      if (this.d.relayOnly) return connectFailed(this.d.turn ? "turn-failed" : "relay-unavailable");
      return connectFailed(this.d.turn ? "turn-failed" : "no-turn-restrictive-network");
    }
    return connectFailed("peer-unreachable");
  }

  private hostGone(reason: CloseReason): void {
    if (this.closed || this.isHost) return;
    // Still joining: the game has no room yet, so the join itself fails.
    if (this.phase === "joining") return this.failJoin(connectFailed("room-closed"));
    this.ev.emit("host-left");
    this.finish(reason, false);
  }

  /** Tear everything down. `silentClose` skips the `closed` event (a failed join rejects instead). */
  private finish(reason: CloseReason, byeToServer: boolean, silentClose = false): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    for (const t of this.dropTimers.values()) clearTimeout(t);
    for (const p of this.pendingJoins.values()) clearTimeout(p.timer);
    for (const [, r] of this.reqs) {
      clearTimeout(r.timer);
      r.reject(new P2PError("closed", "You're no longer in this room."));
    }
    this.reqs.clear();
    this.voice.shutdown();
    for (const link of [...this.links.values()]) link.closeSoon(300);
    this.sig?.close(byeToServer || this.isHost);
    for (const u of this.unlisten) u();
    // Safety net: a join can never be left pending on a closed room.
    const waiter = this.joinWaiter;
    this.joinWaiter = undefined;
    waiter?.reject(connectFailed("room-closed"));
    if (!silentClose) this.ev.emit("closed", { reason });
    this.d.onClosed();
  }

  private pageGone(): void {
    if (this.closed) return;
    for (const l of this.links.values()) this.sendCtl(l, "bye", this.isHost ? { host: true } : null);
    this.finish("left", true);
  }

  private setHidden(hidden: boolean): void {
    if (this.closed || hidden === this.hidden) return;
    this.hidden = hidden;
    for (const s of this.isHost ? [this.st, this.view] : [this.view]) {
      const me = s.players.find((p) => p.id === this.selfId);
      if (me) me.hidden = hidden;
    }
    for (const l of this.links.values()) if (l.open) this.sendCtl(l, "vis", hidden);
  }

  // ── internals: ping, clock, connection info ────────────────────────────────

  private startPings(): void {
    let n = 0;
    this.pingTimer = setInterval(() => {
      n++;
      for (const link of this.links.values()) {
        if (!link.open) continue;
        this.ping(link);
        if (n % 3 === 0) void this.refreshRelay(link.id);
      }
    }, PING_EVERY_MS);
  }

  private burstPing(id: string): void {
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const link = this.links.get(id);
        if (link?.open) this.ping(link);
      }, i * 120);
    }
  }

  private ping(link: PeerLink): void {
    const t0 = env.now();
    const log = this.pings.get(link.id) ?? [];
    log.push({ t0, ok: false });
    if (log.length > 30) log.shift();
    this.pings.set(link.id, log);
    this.sendCtl(link, "ping", t0, false);
  }

  private onPong(from: string, body: unknown): void {
    if (!Array.isArray(body)) return;
    const [t0, remote] = body as [number, number];
    const t1 = env.now();
    const entry = this.pings.get(from)?.find((p) => p.t0 === t0);
    if (!entry || entry.ok) return;
    entry.ok = true;
    const rtt = t1 - t0;
    this.rtt.set(from, smooth(this.rtt.get(from) ?? null, rtt));
    if (from === this.hostId && !this.isHost) this.clock.add(t0, remote, t1);
  }

  private loss(id: string): number | null {
    const cutoff = env.now() - 3000;
    const settled = (this.pings.get(id) ?? []).filter((p) => p.t0 < cutoff).slice(-20);
    if (!settled.length) return null;
    return Math.round((100 * settled.filter((p) => !p.ok).length) / settled.length);
  }

  private async refreshRelay(id: string): Promise<void> {
    const link = this.links.get(id);
    if (!link) return;
    const before = link.relay;
    await link.stats();
    if (link.relay !== before) this.connChanged(id);
  }

  private connChanged(id: string): void {
    if (this.phase !== "joined") return;
    const p = this.view.players.find((x) => x.id === id);
    if (p) this.ev.emit("player-update", this.toPlayer(p));
  }

  private conn(id: string): PlayerConnection {
    if (id === this.selfId) return { state: "connected", rttMs: 0, relay: false };
    const link = this.links.get(id);
    const state = link?.open ? "connected" : link?.state === "disrupted" ? "reconnecting" : "connecting";
    const rtt = this.rtt.get(id);
    return { state, rttMs: rtt == null ? null : Math.round(rtt), relay: link?.relay ?? false };
  }

  private toPlayer(p: PState): Player {
    return {
      id: p.id,
      name: p.name,
      avatarUrl: p.avatarUrl,
      isHost: p.id === this.hostId,
      isSelf: p.id === this.selfId,
      ready: p.ready,
      meta: clone(p.meta),
      connection: this.conn(p.id),
      hidden: p.hidden,
    };
  }

  private refusal(r: Refusal | undefined): Error {
    return roomError(r?.code ?? "room-not-found", {
      code: this.code,
      hostVersion: r?.hostVersion,
      mine: this.d.gameVersion,
      reason: r?.reason,
    });
  }

  // ── internals: guards ──────────────────────────────────────────────────────

  private hostOnly(what: string): void {
    this.alive();
    if (!this.isHost) throw new P2PError("not-host", `Only the host can ${what}.`);
  }

  private alive(): void {
    if (this.closed) throw new P2PError("closed", "You're no longer in this room.");
  }

  /** For the voice module. */
  forEachOpenLink(fn: (link: PeerLink) => void): void {
    for (const l of this.links.values()) if (l.state !== "closed") fn(l);
  }

  control(link: PeerLink, kind: string, body: unknown): void {
    this.sendCtl(link, kind, body);
  }

  reportError(err: Error): void {
    this.ev.emit("error", err);
  }
}

function mergeMeta(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) delete out[k];
    else out[k] = v;
  }
  return out;
}


export function clampPlayers(n: unknown): number {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_PLAYERS, Math.max(1, v)) : 4;
}
