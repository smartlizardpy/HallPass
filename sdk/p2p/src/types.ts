/**
 * HallPass P2P SDK — public types. This file IS the `.d.ts` games code against
 * (tsup bundles it into `hallpass-p2p.d.ts`). Section 4 of the brief is the
 * contract; additions beyond it are marked "Extension" and listed in HANDOFF.md.
 */

export type TransportKind = "auto" | "hallpass" | "local";

/** Local transport only: network conditions applied on send. */
export interface SimulateOptions {
  /** One-way latency added to every frame, both channels. */
  latencyMs?: number;
  /** Extra random delay 0..jitterMs. Reliable frames stay in order. */
  jitterMs?: number;
  /** Percentage (0–100) of UNRELIABLE frames dropped. */
  lossPct?: number;
}

export interface ConnectOptions {
  /** Rooms are scoped per game. On HallPass this must be the game's slug. */
  gameId: string;
  /** Joining a room whose host runs another version fails with `version-mismatch`. */
  gameVersion?: string;
  /** Fallback display name when HallPass cannot supply one. */
  name?: string;
  /** `'auto'` = `'local'` on localhost / 127.0.0.1 / [::1], else `'hallpass'`. */
  transport?: TransportKind;
  /** Route all traffic through TURN so peers never see each other's IP. */
  relayOnly?: boolean;
  /** Local transport only. */
  simulate?: SimulateOptions | null;
  /** Log to the console. */
  debug?: boolean;
  /** Extension: HallPass origin for the `hallpass` transport. Default: page origin. */
  api?: string;
  /** Extension: replace the ICE servers (the `local` transport uses none by default). */
  iceServers?: RTCIceServer[];
}

export interface SelfInfo {
  /** Opaque, random per client (per `connect()`), never linked to an account. */
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface CreateRoomOptions {
  /** 1–8, default 4. */
  maxPlayers?: number;
  /** Host-owned room metadata (JSON, ≤ 8 KB). */
  meta?: Record<string, unknown>;
  /** Lock the room when `start()` is called, so nobody can join a started game. */
  lockOnStart?: boolean;
}

/** Extension: options for `joinRoom`. */
export interface JoinRoomOptions {
  /** Give up after this long. Default 20000. */
  timeoutMs?: number;
}

export type ConnectionState = "connecting" | "connected" | "reconnecting";

/** How THIS client's link to that player looks. Not replicated. */
export interface PlayerConnection {
  state: ConnectionState;
  /** Round-trip time of this client's link to that player; `null` until measured (and 0 for yourself). */
  rttMs: number | null;
  /** True when this link goes through a TURN relay. */
  relay: boolean;
}

export interface Player {
  id: string;
  name: string;
  avatarUrl: string | null;
  isHost: boolean;
  isSelf: boolean;
  ready: boolean;
  meta: Record<string, unknown>;
  connection: PlayerConnection;
  /** Extension: the player's tab is in the background (see the `visibility` event). */
  hidden: boolean;
}

/** `'others'` (default) | `'all'` (includes you, delivered async) | `'host'` | a peer id | peer ids. */
export type SendTarget = "others" | "all" | "host" | (string & {}) | string[];

export interface SendOptions {
  to?: SendTarget;
  /** Default `true`. Unreliable messages may drop or reorder and are never retried. */
  reliable?: boolean;
}

export interface MessageMeta {
  from: string;
  /** `room.now()` on the sender when it sent the message (host clock). */
  sentAt: number;
  reliable: boolean;
}

/** JSON-serialisable value, or binary (`ArrayBuffer` / any typed array / `DataView`). */
export type MessageData = unknown;

export type MessageHandler<T = unknown> = (data: T, meta: MessageMeta) => void;
export type RequestHandler<T = unknown, R = unknown> = (data: T, meta: MessageMeta) => R | Promise<R>;

export interface RequestOptions {
  /** Default 5000. */
  timeoutMs?: number;
}

export type LeaveReason = "left" | "kicked" | "disconnected" | "timeout";

/**
 * Why a room closed for you:
 * `left` (you called leave) · `kicked` · `host-left` (the host left or its tab closed) ·
 * `timeout` (the host was unreachable for 10 s) · `error`.
 */
export type CloseReason = "left" | "kicked" | "host-left" | "timeout" | "error";

export interface StartEvent {
  payload: unknown;
  /** Host-clock time (compare with `room.now()`) at which every peer should begin. */
  startAt: number;
}

export interface PeerStats {
  rttMs: number | null;
  /** Ping loss on the unreliable channel over the last ~20 pings, 0–100. */
  lossPct: number | null;
  bytesIn: number;
  bytesOut: number;
  relay: boolean;
}

export type NatType = "cone" | "symmetric" | "udp-blocked" | "unknown";

export interface SelfTestResult {
  /** A STUN server answered: direct connections are possible from this network. */
  stun: boolean;
  /** A TURN relay is configured and reachable. */
  turn: boolean;
  natType?: NatType;
  /** Plain-language findings, safe to show a player. */
  notes: string[];
}

export interface SelfTestOptions {
  /** HallPass origin (default: page origin). */
  api?: string;
  /** The game id used to fetch ICE servers (default: the demo id). */
  gameId?: string;
  /** Use these ICE servers instead of asking HallPass. */
  iceServers?: RTCIceServer[];
  timeoutMs?: number;
}

export type ErrorCode =
  | "room-not-found"
  | "room-full"
  | "room-locked"
  | "version-mismatch"
  | "connect-failed"
  | "timeout"
  | "closed"
  | "not-host"
  | "peer-left"
  | "handler-error"
  | "message-too-large"
  | "send-buffer-full"
  | "invalid-argument"
  | "already-in-room"
  | "unsupported"
  | "mic-denied"
  | "mic-unavailable";

/** Every error the SDK throws or rejects with. `message` is written for players. */
export interface P2PErrorShape extends Error {
  code: ErrorCode;
  /** For `connect-failed` (and a few others): a machine-readable cause. */
  reason?: string;
}

export interface VoiceStartOptions {
  echoCancellation?: boolean;
  noiseSuppression?: boolean;
  autoGainControl?: boolean;
}

export interface Voice {
  /** Asks for the microphone, then sends your voice to every player. */
  start(opts?: VoiceStartOptions): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
  setPeerMuted(peerId: string, muted: boolean): void;
  readonly active: boolean;
  readonly muted: boolean;
  on(event: "stream", cb: (e: { peerId: string; stream: MediaStream }) => void): () => void;
  on(event: "stream-end", cb: (e: { peerId: string }) => void): () => void;
}

export interface Room {
  readonly code: string;
  readonly selfId: string;
  readonly hostId: string;
  readonly isHost: boolean;
  readonly meta: Record<string, unknown>;
  readonly players: Player[];
  readonly locked: boolean;
  readonly started: boolean;
  /** Extension. */
  readonly maxPlayers: number;
  readonly voice: Voice;

  setReady(ready: boolean): void;
  /** Shallow-merges into your player meta (set a key to `null` to clear it). */
  setPlayerMeta(meta: Record<string, unknown>): void;
  /** Host only. Shallow-merges into the room meta. */
  setRoomMeta(meta: Record<string, unknown>): void;
  lock(): void;
  unlock(): void;
  kick(peerId: string, reason?: string): void;
  start(payload?: unknown): void;

  send(event: string, data?: MessageData, opts?: SendOptions): void;

  on(event: "player-join", cb: (player: Player) => void): () => void;
  on(event: "player-leave", cb: (e: { id: string; reason: LeaveReason }) => void): () => void;
  on(event: "player-update", cb: (player: Player) => void): () => void;
  on(event: "room-update", cb: (room: Room) => void): () => void;
  on(event: "start", cb: (e: StartEvent) => void): () => void;
  on(event: "host-left", cb: () => void): () => void;
  on(event: "kicked", cb: (e: { reason: string }) => void): () => void;
  on(event: "closed", cb: (e: { reason: CloseReason }) => void): () => void;
  on(event: "visibility", cb: (e: { id: string; hidden: boolean }) => void): () => void;
  on(event: "error", cb: (err: P2PErrorShape) => void): () => void;
  on<T = unknown>(event: string, cb: MessageHandler<T>): () => void;
  /** Extension: remove a listener added with `on`. */
  off(event: string, cb: (...args: never[]) => void): void;

  handle<T = unknown, R = unknown>(event: string, handler: RequestHandler<T, R>): () => void;
  request<R = unknown>(to: string, event: string, data?: MessageData, opts?: RequestOptions): Promise<R>;

  now(): number;
  stats(): Promise<Record<string, PeerStats>>;
  leave(): Promise<void>;
}

export interface Client {
  readonly self: SelfInfo;
  /** Extension: the transport actually in use. */
  readonly transport: "hallpass" | "local";
  createRoom(opts?: CreateRoomOptions): Promise<Room>;
  joinRoom(code: string, opts?: JoinRoomOptions): Promise<Room>;
  close(): Promise<void>;
}
