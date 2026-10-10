/**
 * P2P SDK version, single source of truth (semver). Exposed as
 * `HallPassP2P.version` and stamped into the built file's banner. The hosted
 * path is the major (`/sdk/p2p/v1/`), patched in place within it — the same
 * append-only rule as `/sdk/v1/` (see sdk/PUBLISH.md).
 */
export const P2P_VERSION = "1.0.0";
export const P2P_MAJOR = "1";
