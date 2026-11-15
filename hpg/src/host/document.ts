/**
 * Build the HTML document a game frame loads through `srcdoc`: the package's
 * entry with the guest runtime injected as the first two scripts of `<head>`.
 *
 * The entry is PARSED (DOMParser), the scripts are inserted as nodes, and the
 * result is serialised. No string search over game HTML is done, so nothing a
 * game contains (a `<head>` inside a comment or a string) can move the
 * injection point. The packager has already parsed and re-serialised the same
 * document with jsdom, so the round trip is stable.
 *
 * Inline-script safety: the HTML serialiser does NOT escape script text, so the
 * two injected scripts must not contain `</script`. The config is JSON with
 * every `<` escaped as `<` (also covering `<!--`), plus U+2028/2029. The
 * runtime is esbuild output, which escapes `</script` in strings itself, and
 * {@link buildGameDocument} asserts it.
 */

import { mimeTypeOf } from "../format/paths";
import type { LoadedPackage } from "../archive/package";
import type { GuestConfig, GuestFile } from "../guest/install";

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
  }
  return btoa(bin);
}

export function scriptSafeJson(value: unknown): string {
  // U+2028/2029 are written as escapes via fromCharCode so this source file
  // never contains a raw line separator (which would end a regex literal).
  const LS = String.fromCharCode(0x2028);
  const PS = String.fromCharCode(0x2029);
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .split(LS)
    .join("\\u2028")
    .split(PS)
    .join("\\u2029");
}

/** Every package file except the entry and the cover, exposed as `hpg:/<path>`. */
export function guestFilesOf(pkg: LoadedPackage): { files: Record<string, GuestFile>; classicWorkers: string[] } {
  const files: Record<string, GuestFile> = {};
  const classicWorkers: string[] = [];
  for (const [path, entry] of Object.entries(pkg.manifest.files)) {
    if (entry.role === "entry" || entry.role === "thumbnail") continue;
    files[path] = { type: mimeTypeOf(path), b64: toBase64(pkg.files.get(path)!) };
    if (entry.role === "worker") classicWorkers.push(path);
  }
  return { files, classicWorkers };
}

export function buildGameDocument(
  entryHtml: string,
  config: GuestConfig,
  runtimeJs: string,
  parser: DOMParser = new DOMParser(),
): string {
  if (/<\/script/i.test(runtimeJs)) throw new Error("guest runtime contains </script and cannot be inlined");
  const doc = parser.parseFromString(entryHtml, "text/html");
  const head = doc.head;
  const boot = doc.createElement("script");
  boot.textContent = `window.__HPG_BOOT__=${scriptSafeJson(config)};`;
  const runtime = doc.createElement("script");
  runtime.textContent = runtimeJs;
  head.insertBefore(runtime, head.firstChild);
  head.insertBefore(boot, runtime);
  // A charset declaration must come first in <head>; keep the game's if it had one.
  const charset = head.querySelector("meta[charset]");
  if (charset) head.insertBefore(charset, boot);
  return `<!DOCTYPE html>\n${doc.documentElement.outerHTML}`;
}
