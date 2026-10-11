/**
 * Meme avatars: the face of every player.
 *
 * A player's Google photo (`players.image`) is often a real photograph of a
 * child, so it is never shown publicly. Everyone has a meme avatar: a circle in
 * one of eight background colours with a meme cutout on top. The player picks
 * ONLY the meme and the colour (settings); the framing of each cutout inside the
 * circle is fixed per meme by the art pack (`tools/avatar-creator`), so there is
 * nothing else to choose or to get wrong. The real photo appears only to
 * accepted friends and only if the player opted in (`players.use_google_photo`).
 *
 * STORED CHOICE. `players.avatar_meme` / `players.avatar_colour` (migration 045)
 * are both nullable. NULL means "never chose": the default is then a pure
 * function of `public_id` - never `players.id`, the Google subject, which must
 * not be derived from or sent anywhere. A stored value that is no longer valid
 * (a meme removed from the catalogue, a colour dropped from the palette) is
 * treated as unset field by field, so a catalogue change can never break a
 * saved avatar. The database deliberately does NOT enumerate the ids in a CHECK;
 * this module is the single source of truth.
 *
 * WIRE FORMAT. Avatars cross the wire as the existing `image` string. A meme
 * avatar is `/avatars/<id>.png?bg=<6 hex digits>`; anything else is a Google
 * photo URL. {@link parseAvatarRef} is the only reader of that format.
 */

export interface MemeAvatar {
  /** Stable slug; also the file name `public/avatars/<id>.png`. Never an index. */
  id: string;
  name: string;
  /** Background colour this meme defaults to when the player has not picked one. */
  colour: string;
  /** Fixed framing inside the circle, as in the art pack (not player-editable). */
  scale: number;
  x: number;
  y: number;
}

/** The approved catalogue (art pack `catalogue.js`). Append; never reorder ids. */
export const MEME_AVATARS: readonly MemeAvatar[] = [
  { id: "gigachad", name: "GigaChad", colour: "#c5b8ff", scale: 1, x: -0.095, y: 0.072 },
  { id: "mocking-spongebob", name: "Mocking SpongeBob", colour: "#ffb49c", scale: 1, x: 0, y: 0 },
  { id: "caveman-spongebob", name: "Caveman SpongeBob", colour: "#a5decf", scale: 1, x: -0.024, y: 0.053 },
  { id: "surprised-pikachu", name: "Surprised Pikachu", colour: "#a9d3f5", scale: 1, x: 0.021, y: 0.193 },
  { id: "crying-cat", name: "Crying Cat", colour: "#ffd982", scale: 0.91, x: -0.002, y: 0.208 },
  { id: "polite-cat", name: "Polite Cat", colour: "#f3add5", scale: 1, x: 0.048, y: 0.195 },
  { id: "smudge-cat", name: "Smudge the Cat", colour: "#c5b8ff", scale: 1, x: 0.03, y: 0.175 },
  { id: "cheems", name: "Cheems", colour: "#ffb49c", scale: 1, x: 0.019, y: 0.036 },
  { id: "roll-safe", name: "Roll Safe", colour: "#a5decf", scale: 1, x: 0.044, y: 0.134 },
  { id: "nick-young", name: "Confused Nick Young", colour: "#a9d3f5", scale: 1, x: 0.113, y: 0.067 },
  { id: "blinking-guy", name: "Blinking White Guy", colour: "#a9d3f5", scale: 1.13, x: -0.232, y: 0.007 },
  { id: "jake-peralta", name: "Jake Peralta", colour: "#c5b8ff", scale: 1, x: 0, y: 0.1 },
  { id: "savage-patrick", name: "Savage Patrick", colour: "#c5b8ff", scale: 1, x: 0.028, y: 0.232 },
  { id: "squidward", name: "Squidward", colour: "#ffb49c", scale: 1.08, x: 0.045, y: 0.211 },
  { id: "doge", name: "Doge", colour: "#a5decf", scale: 1, x: 0.032, y: 0.099 },
  { id: "side-eye-dog", name: "Side Eye Dog", colour: "#a9d3f5", scale: 1, x: 0.027, y: -0.023 },
  { id: "pop-cat", name: "Pop Cat", colour: "#ffd982", scale: 1, x: -0.023, y: 0.089 },
  { id: "monkey-puppet", name: "Monkey Puppet", colour: "#f3add5", scale: 0.99, x: 0.031, y: 0.139 },
  { id: "harold", name: "Hide the Pain Harold", colour: "#c5b8ff", scale: 0.81, x: 0.016, y: -0.004 },
  { id: "math-lady", name: "Confused Math Lady", colour: "#ffb49c", scale: 0.91, x: 0.001, y: 0.024 },
  { id: "kermit-tea", name: "Kermit Sipping Tea", colour: "#a5decf", scale: 1, x: 0.008, y: 0.109 },
  { id: "elmo-rise", name: "Elmo Rise", colour: "#a9d3f5", scale: 1, x: 0.05, y: 0.248 },
  { id: "this-is-fine", name: "This Is Fine", colour: "#ffd982", scale: 1, x: -0.151, y: 0.046 },
  { id: "saban", name: "Şaban", colour: "#f3add5", scale: 1.13, x: 0.128, y: -0.001 },
  { id: "erdal-bakkal", name: "Erdal Bakkal", colour: "#c5b8ff", scale: 1.11, x: 0.139, y: 0.048 },
  { id: "anya", name: "Anya", colour: "#c5b8ff", scale: 0.98, x: 0.003, y: 0.178 },
  { id: "saitama", name: "Saitama", colour: "#a5decf", scale: 1, x: -0.259, y: 0.087 },
  { id: "gojo", name: "Gojo", colour: "#ffd982", scale: 0.95, x: 0.092, y: 0.141 },
  { id: "enel", name: "Enel", colour: "#ffd982", scale: 1, x: 0.193, y: 0.064 },
  { id: "chopper", name: "Chopper", colour: "#f3add5", scale: 1, x: 0.152, y: 0.014 },
  { id: "totoro", name: "Totoro", colour: "#c5b8ff", scale: 1.02, x: 0.022, y: 0.176 },
  { id: "jiji", name: "Jiji", colour: "#ffb49c", scale: 1, x: -0.001, y: 0.08 },
  { id: "no-face", name: "No-Face", colour: "#a5decf", scale: 1, x: -0.089, y: -0.016 },
];

/** The eight background colours the player may choose from. */
export const AVATAR_COLOURS: readonly string[] = [
  "#c5b8ff",
  "#ffb49c",
  "#a5decf",
  "#a9d3f5",
  "#ffd982",
  "#f3add5",
  "#b5bdc9",
  "#eee9db",
];

const MEME_BY_ID = new Map(MEME_AVATARS.map((m) => [m.id, m]));

export function getMemeAvatar(id: unknown): MemeAvatar | null {
  return typeof id === "string" ? (MEME_BY_ID.get(id) ?? null) : null;
}

/** Normalises to lowercase `#rrggbb` and returns it only if it is in the palette. */
export function normaliseAvatarColour(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  return AVATAR_COLOURS.includes(v) ? v : null;
}

export interface AvatarChoice {
  meme: string;
  colour: string;
}

/**
 * Strict validator for a save: BOTH values must be known, else `null`. Used by
 * the settings action; the client is never trusted.
 */
export function parseAvatarChoice(input: {
  meme: unknown;
  colour: unknown;
}): AvatarChoice | null {
  const meme = getMemeAvatar(input.meme);
  const colour = normaliseAvatarColour(input.colour);
  return meme && colour ? { meme: meme.id, colour } : null;
}

/** FNV-1a, 32-bit: tiny, stable across runtimes, no crypto needed here. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The default meme for a public id. Same id, same meme, always. */
export function defaultMemeFor(publicId: string): MemeAvatar {
  return MEME_AVATARS[hash(publicId.toLowerCase()) % MEME_AVATARS.length];
}

type Stored = { meme?: unknown; colour?: unknown } | null;

/** The avatar a player resolves to, given whatever is stored (possibly nothing or stale). */
export function resolveAvatar(
  publicId: string,
  stored?: Stored,
): { meme: MemeAvatar; colour: string } {
  const meme = getMemeAvatar(stored?.meme) ?? defaultMemeFor(publicId);
  const colour = normaliseAvatarColour(stored?.colour) ?? meme.colour;
  return { meme, colour };
}

/** The meme avatar ref for a public id (plus any stored choice). */
export function memeAvatarFor(publicId: string, stored?: Stored): string {
  const { meme, colour } = resolveAvatar(publicId, stored);
  return `/avatars/${meme.id}.png?bg=${colour.slice(1)}`;
}

/**
 * For query mappers: the Google photo if the (already privacy-gated) query
 * returned one, else the player's stored meme choice, else `null` so the
 * `Avatar` component falls back to the public-id default.
 */
export function avatarImage(
  photo: string | null,
  publicId: string | null | undefined,
  meme: unknown,
  colour: unknown,
): string | null {
  if (photo) return photo;
  if (!publicId || (meme == null && colour == null)) return null;
  return memeAvatarFor(publicId, { meme, colour });
}

export interface ParsedAvatarRef {
  meme: MemeAvatar;
  colour: string;
}

/** Reads a ref made by {@link memeAvatarFor}; `null` for a photo URL or junk. */
export function parseAvatarRef(src: string | null | undefined): ParsedAvatarRef | null {
  if (!src) return null;
  const m = /^\/avatars\/([a-z0-9-]+)\.png(?:\?bg=([0-9a-f]{6}))?$/.exec(src);
  if (!m) return null;
  const meme = getMemeAvatar(m[1]);
  if (!meme) return null;
  return { meme, colour: normaliseAvatarColour(m[2] ? `#${m[2]}` : null) ?? meme.colour };
}

/** CSS for the cutout inside the circle (percentages of the circle's box). */
export function cutoutStyle(meme: MemeAvatar): {
  width: string;
  height: string;
  left: string;
  top: string;
} {
  const size = meme.scale * 100;
  const offset = (1 - meme.scale) * 50;
  return {
    width: `${size}%`,
    height: `${size}%`,
    left: `${offset + meme.x * 100}%`,
    top: `${offset + meme.y * 100}%`,
  };
}
