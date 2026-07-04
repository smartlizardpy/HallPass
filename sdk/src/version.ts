/**
 * SDK version, single source of truth.
 *
 * `SDK_MAJOR` is exposed at runtime as `window.HallPass.version` and MUST match
 * the `/sdk/vN/` URL the artifact is served from. Bump `SDK_VERSION` on every
 * release; bump `SDK_MAJOR` (and move to a new `/sdk/vN/` path) only on a
 * breaking change.
 */
export const SDK_VERSION = "1.1.0";
export const SDK_MAJOR = "1";
