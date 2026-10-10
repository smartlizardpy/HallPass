/**
 * HallPass P2P SDK — public types. This file IS the `.d.ts` games code against
 * (tsup bundles it into `hallpass-p2p.d.ts`). Section 4 of the brief is the
 * contract; additions beyond it are marked "Extension" and listed in HANDOFF.md.
 */
type TransportKind = "auto" | "hallpass" | "local";
/** Local transport only: network conditions applied on send. */
interface SimulateOptions {
    /** One-way latency added to every frame, both channels. */
    latencyMs?: number;
    /** Extra random delay 0..jitterMs. Reliable frames stay in order. */
    jitterMs?: number;
    /** Percentage (0–100) of UNRELIABLE frames dropped. */
    lossPct?: number;
}
interface ConnectOptions {
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
    /** Extension: replace the ICE servers (default: HallPass's list; none for `local`). */
    iceServers?: RTCIceServer[];
}
interface SelfInfo {
    /** Opaque, random per client (per `connect()`), never linked to an account. */
    id: string;
    name: string;
    avatarUrl: string | null;
}
interface CreateRoomOptions {
    /** 1–8, default 4. */
    maxPlayers?: number;
    /** Host-owned room metadata (JSON, ≤ 8 KB). */
    meta?: Record<string, unknown>;
    /** Lock the room when `start()` is called, so nobody can join a started game. */
    lockOnStart?: boolean;
}
/** Extension: options for `joinRoom`. */
interface JoinRoomOptions {
    /** Give up after this long. Default 20000. */
    timeoutMs?: number;
}
type ConnectionState = "connecting" | "connected" | "reconnecting";
/** How THIS client's link to that player looks. Not replicated. */
interface PlayerConnection {
    state: ConnectionState;
    /** Round-trip time of this client's link to that player; `null` until measured (and 0 for yourself). */
    rttMs: number | null;
    /** True when this link goes through a TURN relay. */
    relay: boolean;
}
interface Player {
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
type SendTarget = "others" | "all" | "host" | (string & {}) | string[];
interface SendOptions {
    to?: SendTarget;
    /** Default `true`. Unreliable messages may drop or reorder and are never retried. */
    reliable?: boolean;
}
interface MessageMeta {
    from: string;
    /** `room.now()` on the sender when it sent the message (host clock). */
    sentAt: number;
    reliable: boolean;
}
/** JSON-serialisable value, or binary (`ArrayBuffer` / any typed array / `DataView`). */
type MessageData = unknown;
type MessageHandler<T = unknown> = (data: T, meta: MessageMeta) => void;
type RequestHandler<T = unknown, R = unknown> = (data: T, meta: MessageMeta) => R | Promise<R>;
interface RequestOptions {
    /** Default 5000. */
    timeoutMs?: number;
}
type LeaveReason = "left" | "kicked" | "disconnected" | "timeout";
/**
 * Why a room closed for you:
 * `left` (you called leave) · `kicked` · `host-left` (the host left or its tab closed) ·
 * `timeout` (the host was unreachable for 10 s) · `error`.
 */
type CloseReason = "left" | "kicked" | "host-left" | "timeout" | "error";
interface StartEvent {
    payload: unknown;
    /** Host-clock time (compare with `room.now()`) at which every peer should begin. */
    startAt: number;
}
interface PeerStats {
    rttMs: number | null;
    /** Ping loss on the unreliable channel over the last ~20 pings, 0–100. */
    lossPct: number | null;
    bytesIn: number;
    bytesOut: number;
    relay: boolean;
}
type NatType = "cone" | "symmetric" | "udp-blocked" | "unknown";
interface SelfTestResult {
    /** A STUN server answered: direct connections are possible from this network. */
    stun: boolean;
    /** A TURN relay is configured and reachable. */
    turn: boolean;
    natType?: NatType;
    /** Plain-language findings, safe to show a player. */
    notes: string[];
}
interface SelfTestOptions {
    /** HallPass origin (default: page origin). */
    api?: string;
    /** The game id used to fetch ICE servers (default: the demo id). */
    gameId?: string;
    /** Use these ICE servers instead of asking HallPass. */
    iceServers?: RTCIceServer[];
    timeoutMs?: number;
}
type ErrorCode = "room-not-found" | "room-full" | "room-locked" | "version-mismatch" | "connect-failed" | "timeout" | "closed" | "not-host" | "peer-left" | "handler-error" | "message-too-large" | "send-buffer-full" | "invalid-argument" | "already-in-room" | "unsupported" | "mic-denied" | "mic-unavailable";
/** Every error the SDK throws or rejects with. `message` is written for players. */
interface P2PErrorShape extends Error {
    code: ErrorCode;
    /** For `connect-failed` (and a few others): a machine-readable cause. */
    reason?: string;
}
interface VoiceStartOptions {
    echoCancellation?: boolean;
    noiseSuppression?: boolean;
    autoGainControl?: boolean;
}
interface Voice {
    /** Asks for the microphone, then sends your voice to every player. */
    start(opts?: VoiceStartOptions): Promise<void>;
    stop(): void;
    setMuted(muted: boolean): void;
    setPeerMuted(peerId: string, muted: boolean): void;
    readonly active: boolean;
    readonly muted: boolean;
    on(event: "stream", cb: (e: {
        peerId: string;
        stream: MediaStream;
    }) => void): () => void;
    on(event: "stream-end", cb: (e: {
        peerId: string;
    }) => void): () => void;
}
interface Room {
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
    on(event: "player-leave", cb: (e: {
        id: string;
        reason: LeaveReason;
    }) => void): () => void;
    on(event: "player-update", cb: (player: Player) => void): () => void;
    on(event: "room-update", cb: (room: Room) => void): () => void;
    on(event: "start", cb: (e: StartEvent) => void): () => void;
    on(event: "host-left", cb: () => void): () => void;
    on(event: "kicked", cb: (e: {
        reason: string;
    }) => void): () => void;
    on(event: "closed", cb: (e: {
        reason: CloseReason;
    }) => void): () => void;
    on(event: "visibility", cb: (e: {
        id: string;
        hidden: boolean;
    }) => void): () => void;
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
interface Client {
    readonly self: SelfInfo;
    /** Extension: the transport actually in use. */
    readonly transport: "hallpass" | "local";
    createRoom(opts?: CreateRoomOptions): Promise<Room>;
    joinRoom(code: string, opts?: JoinRoomOptions): Promise<Room>;
    close(): Promise<void>;
}

/**
 * `HallPassP2P.connect()` and the client it returns: identity, transport
 * choice, ICE configuration (refreshed before TURN credentials expire), and
 * creating or joining one room at a time.
 */

declare function connect(opts: ConnectOptions): Promise<Client>;

/**
 * Every error the SDK raises is a `P2PError` with a stable `code` (and, for
 * `connect-failed`, a `reason`). `message` is written for PLAYERS: a game can
 * show `err.message` as is.
 */

declare class P2PError extends Error {
    code: ErrorCode;
    reason?: string;
    constructor(code: ErrorCode, message: string, reason?: string);
}

/**
 * `HallPassP2P.selfTest()` — what a "Test connection" button needs: can this
 * network reach a STUN server (direct connections possible), is a TURN relay
 * reachable, and a best-effort NAT type. Notes are written for players.
 */

declare function selfTest(opts?: SelfTestOptions): Promise<SelfTestResult>;

/**
 * HallPass P2P co-op SDK — entry point. Builds to one dependency-free ES module
 * (`/sdk/p2p/v1/hallpass-p2p.js`) that games vendor and import relatively:
 *
 *   import { HallPassP2P } from './lib/hallpass-p2p.js';
 *   const client = await HallPassP2P.connect({ gameId: 'last-bell', gameVersion: '1.2.0', name: 'Guest 4821' });
 *   const room = await client.createRoom({ maxPlayers: 4, lockOnStart: true });
 *
 * See sdk/README.md ("P2P co-op") for the full API and the gotchas.
 */

declare const HallPassP2P: {
    /** Semver of this SDK build. */
    version: string;
    connect: typeof connect;
    selfTest: typeof selfTest;
    P2PError: typeof P2PError;
};

export { type Client, type CloseReason, type ConnectOptions, type ConnectionState, type CreateRoomOptions, type ErrorCode, HallPassP2P, type JoinRoomOptions, type LeaveReason, type MessageData, type MessageHandler, type MessageMeta, type NatType, P2PError, type P2PErrorShape, type PeerStats, type Player, type PlayerConnection, type RequestHandler, type RequestOptions, type Room, type SelfInfo, type SelfTestOptions, type SelfTestResult, type SendOptions, type SendTarget, type SimulateOptions, type StartEvent, type TransportKind, type Voice, type VoiceStartOptions, HallPassP2P as default };
