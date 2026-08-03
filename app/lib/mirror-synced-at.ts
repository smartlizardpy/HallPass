/**
 * When the deployed `public/games/` static mirror was last captured from Vercel
 * Blob, as epoch milliseconds. This is the freshness reference
 * {@link chooseGameSource} uses to tell a blob that is already baked into the
 * deploy (serve it from the free CDN twin) from one uploaded since the last sync
 * (proxy it so the edit is live).
 *
 * `0` means "nothing has been synced yet", so every blob reads as newer than the
 * mirror and the route prefers Blob for everything — i.e. the pre-optimisation
 * behaviour, and the safe default. `scripts/sync-games.mjs` overwrites the value
 * below with the time the sync STARTED (so a blob uploaded mid-sync is treated as
 * newer, never as already-mirrored), and commits it alongside the `public/games/`
 * files it wrote, so the stamp and the mirror it describes always ship together.
 *
 * GENERATED — do not edit by hand; `scripts/sync-games.mjs` rewrites the literal.
 */
export const MIRROR_SYNCED_AT = 0;
