/**
 * `HallPassP2P.connect()` and the client it returns: identity, transport
 * choice, ICE configuration (refreshed before TURN credentials expire), and
 * creating or joining one room at a time.
 */

import { derivePeerId, generateSecret, isValidGameId, normalizeCode, sanitizeName, sanitizeVersion } from "./codes";
import { env } from "./env";
import { connectFailed, P2PError } from "./errors";
import { clampPlayers, RoomImpl } from "./room";
import { fetchConfig, httpTransport, localTransport, type Transport } from "./signaling";
import type { Client, ConnectOptions, CreateRoomOptions, JoinRoomOptions, Room, SelfInfo } from "./types";

export const VERSION = "1.0.0";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function pageOrigin(): string {
  try {
    return location.origin;
  } catch {
    return "";
  }
}

export function defaultApi(): string {
  try {
    const api = (globalThis as { HALLPASS_CONFIG?: { api?: unknown } }).HALLPASS_CONFIG?.api;
    if (typeof api === "string" && api) return api;
  } catch {
    // fall through
  }
  return pageOrigin();
}

function autoTransport(): "local" | "hallpass" {
  try {
    return LOCAL_HOSTS.has(location.hostname) ? "local" : "hallpass";
  } catch {
    return "local";
  }
}

function randomId(): string {
  const a = "abcdefghijklmnopqrstuvwxyz234567";
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => a[b & 31]).join("");
}

export async function connect(opts: ConnectOptions): Promise<Client> {
  if (!opts || !isValidGameId(opts.gameId)) {
    throw new P2PError("invalid-argument", 'connect() needs a gameId made of lowercase letters, digits and dashes, like "last-bell".');
  }
  if (!env.RTCPeerConnection) {
    throw new P2PError("unsupported", "This browser doesn't support peer-to-peer connections (WebRTC).");
  }
  const log = opts.debug ? (...a: unknown[]) => console.log("[hallpass-p2p]", ...a) : () => {};
  const kind = opts.transport && opts.transport !== "auto" ? opts.transport : autoTransport();
  const api = (opts.api || defaultApi()).replace(/\/+$/, "");
  const secret = generateSecret();
  // The local transport has no server to prove the id to, and crypto.subtle is
  // missing on plain-http LAN addresses; a random id is enough there.
  const id = kind === "local" && !globalThis.crypto?.subtle ? randomId() : await derivePeerId(secret);

  const cfg = kind === "hallpass" ? await fetchConfig(api, opts.gameId) : null;
  if (kind === "hallpass" && !cfg) log("HallPass config unavailable; using the fallback name and public STUN");
  if (kind !== "local" && opts.simulate) log("simulate only applies to the local transport; ignored");

  const self: SelfInfo = {
    id,
    name: cfg?.self?.name ?? sanitizeName(opts.name, "Player"),
    avatarUrl: cfg?.self?.avatarUrl ?? null,
  };
  log("connected", { transport: kind, id, turn: cfg?.turn ?? false });
  return new ClientImpl(opts, kind, api, secret, self, log, cfg);
}

class ClientImpl implements Client {
  private room: RoomImpl | null = null;
  private busy = false;
  private closed = false;
  private t: Transport;
  private ice: { servers: RTCIceServer[]; expiresAt: number | null; turn: boolean; forceRelay: boolean };
  private refreshTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private opts: ConnectOptions,
    readonly transport: "hallpass" | "local",
    private api: string,
    private secret: string,
    readonly self: SelfInfo,
    private log: (...a: unknown[]) => void,
    cfg: Awaited<ReturnType<typeof fetchConfig>>,
  ) {
    this.t = transport === "local" ? localTransport() : httpTransport(api, log);
    this.ice = {
      servers: opts.iceServers ?? (transport === "local" ? [] : (cfg?.iceServers ?? [{ urls: "stun:stun.l.google.com:19302" }])),
      expiresAt: cfg?.iceExpiresAt ?? null,
      turn: cfg?.turn ?? false,
      forceRelay: cfg?.forceRelay ?? false,
    };
    this.scheduleRefresh();
  }

  async createRoom(opts: CreateRoomOptions = {}): Promise<Room> {
    this.guard();
    const meta = opts.meta ?? {};
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      throw new P2PError("invalid-argument", "Room meta must be a plain object.");
    }
    if (JSON.stringify(meta).length > 8192) throw new P2PError("invalid-argument", "Room meta is too large (8 KB max).");
    const relayOnly = this.needRelay(false);
    this.busy = true;
    try {
      const gameVersion = sanitizeVersion(this.opts.gameVersion);
      let room: RoomImpl | null = null;
      const { sig, code } = await this.t.create({
        gameId: this.opts.gameId,
        gameVersion,
        relayOnly,
        selfId: this.self.id,
        secret: this.secret,
        precheck: (v, from) => (room ? room.precheck(v, from) : { code: "room-not-found" }),
      });
      room = this.newRoom(code, this.self.id, true, relayOnly);
      room.hostInit(sig, { max: clampPlayers(opts.maxPlayers ?? 4), meta: JSON.parse(JSON.stringify(meta)), lockOnStart: !!opts.lockOnStart });
      this.log("room created", code);
      return room;
    } finally {
      this.busy = false;
    }
  }

  async joinRoom(code: string, opts: JoinRoomOptions = {}): Promise<Room> {
    this.guard();
    const c = normalizeCode(code);
    if (!c) throw new P2PError("room-not-found", "Room codes are 4 letters or numbers, like K7QX.");
    this.needRelay(false);
    this.busy = true;
    try {
      const { sig, hostId, relayOnly: roomRelay } = await this.t.join(c, {
        gameId: this.opts.gameId,
        gameVersion: sanitizeVersion(this.opts.gameVersion),
        selfId: this.self.id,
        secret: this.secret,
        name: this.self.name,
      });
      let relayOnly: boolean;
      try {
        relayOnly = this.needRelay(roomRelay);
      } catch (e) {
        sig.close(false);
        throw e;
      }
      const room = this.newRoom(c, hostId, false, relayOnly);
      try {
        return await room.joinFlow(sig, Math.max(1000, opts.timeoutMs ?? 20000));
      } catch (e) {
        if (this.room === room) this.room = null;
        throw e;
      }
    } finally {
      this.busy = false;
    }
  }

  async close(): Promise<void> {
    if (this.closed) return;
    await this.room?.leave();
    this.closed = true;
    clearTimeout(this.refreshTimer);
  }

  private newRoom(code: string, hostId: string, isHost: boolean, relayOnly: boolean): RoomImpl {
    const room = new RoomImpl({
      code,
      selfId: this.self.id,
      hostId,
      isHost,
      self: { name: this.self.name, avatarUrl: this.self.avatarUrl },
      gameVersion: sanitizeVersion(this.opts.gameVersion),
      rtc: () => ({ iceServers: this.ice.servers, iceTransportPolicy: relayOnly ? "relay" : "all" }),
      simulate: this.transport === "local" ? (this.opts.simulate ?? null) : null,
      log: this.log,
      onClosed: () => {
        if (this.room === room) this.room = null;
      },
      turn: this.ice.turn,
      relayOnly,
    });
    this.room = room;
    return room;
  }

  /** Whether this connection must be relay-only; throws when that cannot work. */
  private needRelay(roomRelay: boolean): boolean {
    if (this.transport === "local") return false; // one machine: nothing to hide, no TURN
    const relay = !!this.opts.relayOnly || this.ice.forceRelay || roomRelay;
    if (relay && !this.ice.turn) throw connectFailed("relay-unavailable");
    return relay;
  }

  private guard(): void {
    if (this.closed) throw new P2PError("closed", "This connection was closed. Call HallPassP2P.connect() again.");
    if (this.busy || (this.room && !this.room.closed)) {
      throw new P2PError("already-in-room", "You're already in a room. Leave it before creating or joining another.");
    }
  }

  /** Fetch fresh TURN credentials ten minutes before the current ones expire. */
  private scheduleRefresh(): void {
    clearTimeout(this.refreshTimer);
    const exp = this.ice.expiresAt;
    if (this.transport !== "hallpass" || !exp || this.opts.iceServers) return;
    const wait = Math.max(60_000, exp - Date.now() - 10 * 60_000);
    this.refreshTimer = setTimeout(async () => {
      if (this.closed) return;
      const cfg = await fetchConfig(this.api, this.opts.gameId);
      if (cfg) {
        this.ice = { servers: cfg.iceServers, expiresAt: cfg.iceExpiresAt, turn: cfg.turn, forceRelay: cfg.forceRelay };
        for (const link of this.room?.links.values() ?? []) {
          try {
            link.pc.setConfiguration({ ...link.pc.getConfiguration(), iceServers: cfg.iceServers });
          } catch (e) {
            this.log("ICE refresh failed", e);
          }
        }
      }
      this.scheduleRefresh();
    }, wait);
  }
}
