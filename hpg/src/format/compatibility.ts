/**
 * Whether THIS launcher can run a structurally valid manifest. Separate from
 * validation because the answer depends on the launcher, not the package: a
 * perfectly valid package built for launcher 2.0 is "too new", not "corrupt",
 * and the user is told something different in each case.
 */

import { HPG_FORMAT_VERSION, LAUNCHER_VERSION } from "./constants";
import type { HpgManifest } from "./manifest";
import { compareSemver } from "./semver";

export type Compatibility =
  | { ok: true }
  | { ok: false; reason: "format-too-new" | "launcher-too-old"; detail: string };

export function checkCompatibility(
  manifest: Pick<HpgManifest, "formatVersion" | "minimumLauncherVersion">,
  launcherVersion: string = LAUNCHER_VERSION,
): Compatibility {
  if (manifest.formatVersion > HPG_FORMAT_VERSION) {
    return {
      ok: false,
      reason: "format-too-new",
      detail: `package format ${manifest.formatVersion}, launcher reads ${HPG_FORMAT_VERSION}`,
    };
  }
  if (compareSemver(manifest.minimumLauncherVersion, launcherVersion) > 0) {
    return {
      ok: false,
      reason: "launcher-too-old",
      detail: `needs launcher ${manifest.minimumLauncherVersion}, this is ${launcherVersion}`,
    };
  }
  return { ok: true };
}
