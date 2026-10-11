/**
 * Meme avatars: the default face of every player.
 *
 * A player's Google photo (`players.image`) is often a real photograph of a
 * child, so it is no longer shown publicly. Everyone gets a meme avatar picked
 * from their PUBLIC id; the real photo appears only to accepted friends and only
 * if the player opted in (`players.use_google_photo`).
 *
 * The pick is a pure function of `public_id` - never `players.id`, the Google
 * subject, which must not be derived from or sent anywhere. The images live at
 * `public/avatars/meme-01.png` ... `meme-06.png`; this module knows only the
 * filenames, so the art can be replaced without touching code.
 */

export const MEME_AVATAR_COUNT = 6;

/** FNV-1a, 32-bit: tiny, stable across runtimes, no crypto needed here. */
function hash(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** The meme avatar URL for a public id. Same id, same avatar, always. */
export function memeAvatarFor(publicId: string): string {
  const n = (hash(publicId.toLowerCase()) % MEME_AVATAR_COUNT) + 1;
  return `/avatars/meme-${String(n).padStart(2, "0")}.png`;
}
