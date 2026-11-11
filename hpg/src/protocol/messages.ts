/**
 * The postMessage protocol between a running game (the "guest", inside the
 * sandboxed frame) and the launcher (the "host").
 *
 * EVERY GUEST MESSAGE IS UNTRUSTED INPUT. The bootstrap and the game share one
 * frame and one realm, so anything the bootstrap can send, game code can send
 * too, including forged messages. The host therefore:
 *   - checks `event.source` is the active frame's window, and that
 *     `event.origin` is `"null"` (an opaque-origin sandbox) — host/session.ts;
 *   - checks the session nonce, which filters out messages from a frame that
 *     has since been replaced (it is NOT a secret the game cannot read);
 *   - validates the shape and size of each message HERE, before acting on it;
 *   - gives a message no power beyond what the game could already do: write
 *     ITS OWN save slot, add ITS OWN score, ask to close ITSELF.
 *
 * Envelope: `{ hpg: 1, session, type, id?, payload? }`. `id` pairs a request
 * with its `REPLY`.
 */

export const PROTOCOL_VERSION = 1;

/** Save size ceiling: what a game can make the launcher store per slot. */
export const MAX_SAVE_CHARS = 4 * 1024 * 1024;
export const MAX_SAVE_KEYS = 2000;
const MAX_ERROR_CHARS = 500;
const MAX_HANDLE_CHARS = 32;

/** A game's persisted state: its `localStorage` contents and an optional value from `HPG.save()`. */
export type SaveData = {
  storage: Record<string, string>;
  custom?: unknown;
};

export type ScoreEntry = { rank: number; handle: string; score: number; at: number };

export type GuestMessage =
  | { type: "GAME_READY" }
  | { type: "GAME_EXIT" }
  | { type: "GAME_ERROR"; payload: { message: string } }
  | { type: "SCORE_SUBMIT"; id: number; payload: { score: number; handle?: string } }
  | { type: "SCORES_REQUEST"; id: number; payload: { limit: number } }
  | { type: "SAVE_REQUEST"; payload: SaveData }
  | { type: "LOAD_REQUEST"; id: number };

export type HostMessage =
  | { type: "PAUSE" }
  | { type: "RESUME" }
  | { type: "MUTE"; payload: { muted: boolean } }
  | { type: "FLUSH" }
  | { type: "REPLY"; id: number; payload: unknown };

export type Envelope<M> = M & { hpg: typeof PROTOCOL_VERSION; session: string };

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/**
 * Validate a save payload: string→string map within the limits, and a
 * `custom` value that survived structured clone and is JSON-serialisable
 * within the same character budget.
 */
export function validateSaveData(v: unknown): SaveData | null {
  if (!isObj(v) || !isObj(v.storage)) return null;
  const keys = Object.keys(v.storage);
  if (keys.length > MAX_SAVE_KEYS) return null;
  let chars = 0;
  const storage: Record<string, string> = {};
  for (const k of keys) {
    const val = v.storage[k];
    if (typeof val !== "string") return null;
    chars += k.length + val.length;
    if (chars > MAX_SAVE_CHARS) return null;
    storage[k] = val;
  }
  const out: SaveData = { storage };
  if ("custom" in v && v.custom !== undefined) {
    let json: string;
    try {
      json = JSON.stringify(v.custom);
    } catch {
      return null;
    }
    if (json === undefined || chars + json.length > MAX_SAVE_CHARS) return null;
    out.custom = JSON.parse(json);
  }
  return out;
}

/**
 * Parse a message from the guest. Returns `null` for anything that is not a
 * well-formed message of THIS session; the host drops those without replying.
 */
export function parseGuestMessage(data: unknown, session: string): GuestMessage | null {
  if (!isObj(data) || data.hpg !== PROTOCOL_VERSION || data.session !== session) return null;
  switch (data.type) {
    case "GAME_READY":
    case "GAME_EXIT":
      return { type: data.type };
    case "GAME_ERROR": {
      const p = data.payload;
      if (!isObj(p) || typeof p.message !== "string") return null;
      return { type: "GAME_ERROR", payload: { message: p.message.slice(0, MAX_ERROR_CHARS) } };
    }
    case "SCORE_SUBMIT": {
      const p = data.payload;
      if (!isId(data.id) || !isObj(p) || typeof p.score !== "number" || !Number.isFinite(p.score)) return null;
      if (Math.abs(p.score) > 1e15) return null;
      const payload: { score: number; handle?: string } = { score: p.score };
      if (p.handle !== undefined) {
        if (typeof p.handle !== "string") return null;
        const h = p.handle.trim().slice(0, MAX_HANDLE_CHARS);
        if (h) payload.handle = h;
      }
      return { type: "SCORE_SUBMIT", id: data.id, payload };
    }
    case "SCORES_REQUEST": {
      const p = data.payload;
      if (!isId(data.id)) return null;
      const limit = isObj(p) && isId(p.limit) ? Math.min(Math.max(p.limit, 1), 100) : 10;
      return { type: "SCORES_REQUEST", id: data.id, payload: { limit } };
    }
    case "SAVE_REQUEST": {
      const save = validateSaveData(data.payload);
      return save ? { type: "SAVE_REQUEST", payload: save } : null;
    }
    case "LOAD_REQUEST":
      return isId(data.id) ? { type: "LOAD_REQUEST", id: data.id } : null;
    default:
      return null;
  }
}

/** Parse a message from the host, inside the guest. Same rules, other direction. */
export function parseHostMessage(data: unknown, session: string): HostMessage | null {
  if (!isObj(data) || data.hpg !== PROTOCOL_VERSION || data.session !== session) return null;
  switch (data.type) {
    case "PAUSE":
    case "RESUME":
    case "FLUSH":
      return { type: data.type };
    case "MUTE":
      return isObj(data.payload) && typeof data.payload.muted === "boolean"
        ? { type: "MUTE", payload: { muted: data.payload.muted } }
        : null;
    case "REPLY":
      return isId(data.id) ? { type: "REPLY", id: data.id, payload: data.payload } : null;
    default:
      return null;
  }
}

export function envelope<M extends { type: string }>(session: string, msg: M): Envelope<M> {
  return { hpg: PROTOCOL_VERSION, session, ...msg };
}
