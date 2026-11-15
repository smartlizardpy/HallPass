/**
 * Turn a game folder's entry HTML into ONE self-contained document.
 *
 * The HTML is parsed with jsdom and edited as a DOM. JavaScript and CSS go
 * through esbuild, which bundles, resolves imports and minifies. No regular
 * expression edits markup or code. (Regexes appear below only to REPORT remote
 * URLs found in finished output. They decide nothing about what is kept.)
 *
 * What happens to each kind of node:
 *
 * | node                                   | result                                          |
 * |----------------------------------------|-------------------------------------------------|
 * | `<script src=/sdk/v1/hallpass.js>`      | removed; the offline SDK replaces it            |
 * | `<script type=module src=local>`        | bundled (imports, dynamic imports) → inline ESM |
 * | `<script src=local>` (classic)          | minified → inline classic script                |
 * | inline `<script>` (JS types)            | minified (modules bundled)                      |
 * | `<script type=x-shader…>` etc.          | untouched (data, not code)                      |
 * | `<link rel=stylesheet href=local>`      | bundled + minified → `<style>`                  |
 * | `<style>`                               | bundled + minified                              |
 * | `<img|audio|video|source src=local>`    | `data:` URI                                     |
 * | `<link rel=icon href=local>`            | `data:` URI                                     |
 * | `modulepreload`/`preload` of local file | removed (already bundled)                       |
 * | `preconnect`/`dns-prefetch`/`manifest`  | removed (network hints, no content)             |
 * | remote font (adapter-allowed host)      | removed, reported as a font fallback            |
 * | HallPass P2P SDK import (site URL)      | the repo's copy bundled, reported               |
 * | vendored CDN library (script, CSS,     | the pinned copy in hpg/vendor/ inlined,         |
 * |   import, import-map entry)            |   reported (build/vendor.ts)                    |
 * | any other remote resource               | BUILD ERROR                                     |
 *
 * `import(NAME)` where NAME is a file-wide-unique top-level string `const` is
 * first rewritten to `import("…")` (const-imports.ts), so it can be resolved.
 *
 * `import.meta.url` in module code is defined as `hpg:/<path of that file>`,
 * so `new URL("worker.js", import.meta.url)` yields an `hpg:/` URL that the
 * guest runtime resolves (guest/install.ts).
 */

import { build, type Message, type Plugin } from "esbuild";
import { JSDOM, VirtualConsole } from "jsdom";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { mimeTypeOf } from "../format/paths";
import { BROWSER_TARGET } from "./launcher";
import { GOOGLE_FONT_HOSTS, HALLPASS_HOSTS, HALLPASS_P2P_SDK_PATHS, HALLPASS_SDK_PATHS, type GameAdapter } from "./adapter";
import { inlineConstImports } from "./const-imports";
import { checkBundledCode } from "./js-check";
import type { Vendor, VendorHit } from "./vendor";

export type BuildIssue = { level: "error" | "warning" | "info"; message: string };

export class InlineReport {
  issues: BuildIssue[] = [];
  /**
   * The repo's public/ folder, where the packager finds local copies of
   * HallPass's own SDKs (HALLPASS_P2P_SDK_PATHS). Unset: such imports fail
   * like any other remote dependency.
   *
   * `vendor` is hpg/vendor/: pinned copies of CDN libraries (build/vendor.ts).
   * Unset: every CDN URL is a build error.
   */
  constructor(
    readonly publicDir?: string,
    readonly vendor?: Vendor,
  ) {}
  /** The entry's import map, remote entries only: specifier (or "x/" prefix) → URL. */
  importMap = new Map<string, string>();
  /** The pinned local copy of a CDN URL, reported; null if not vendored. */
  vendored(url: string): VendorHit | null {
    let hit: VendorHit | null = null;
    try {
      hit = this.vendor?.lookup(url) ?? null;
    } catch (e) {
      this.error(e instanceof Error ? e.message : String(e));
      return null;
    }
    if (hit) {
      if (hit.pinned) this.warn(`${url} is unversioned; packaged the pinned copy of ${hit.url} from hpg/vendor`);
      else this.info(`packaged the pinned copy of ${hit.url} from hpg/vendor`);
    }
    return hit;
  }
  error(message: string) {
    this.issues.push({ level: "error", message });
  }
  warn(message: string) {
    this.issues.push({ level: "warning", message });
  }
  info(message: string) {
    this.issues.push({ level: "info", message });
  }
  get errors() {
    return this.issues.filter((i) => i.level === "error");
  }
  /** Remote resources dropped as cosmetic, for the manifest's compatibility notes. */
  dropped = new Set<string>();
}

const JS_TYPES = new Set(["", "text/javascript", "application/javascript", "module", "text/ecmascript", "application/ecmascript"]);
// The launcher's own browsers (build/launcher.ts), not a language year: a game
// can only ever run where the launcher runs, and these all support modern
// syntax such as top-level await, which an es2020 target refused.
const TARGET = BROWSER_TARGET;
const DATA_URI_LOADERS = {
  ".png": "dataurl",
  ".jpg": "dataurl",
  ".jpeg": "dataurl",
  ".gif": "dataurl",
  ".webp": "dataurl",
  ".svg": "dataurl",
  ".woff": "dataurl",
  ".woff2": "dataurl",
  ".ttf": "dataurl",
  ".otf": "dataurl",
  ".mp3": "dataurl",
  ".ogg": "dataurl",
  ".wav": "dataurl",
} as const;

export function isRemote(url: string): boolean {
  return /^(https?:)?\/\//i.test(url);
}

/** Resolve a bare specifier through an import map (exact key, then longest "x/" prefix). */
function importMapUrl(spec: string, map: Map<string, string>): string | undefined {
  if (map.has(spec)) return map.get(spec);
  let best = "";
  for (const k of map.keys()) if (k.endsWith("/") && spec.startsWith(k) && k.length > best.length) best = k;
  return best ? map.get(best) + spec.slice(best.length) : undefined;
}

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("//") ? `https:${url}` : url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/**
 * Resolve a reference from the HTML to a file INSIDE the game folder, or report
 * why not. Absolute paths (`/x.js`) are taken as rooted at the game folder, as
 * they are when the game is served from `/game-html/<slug>/`.
 */
export function resolveLocal(gameDir: string, from: string, ref: string, report: InlineReport, what: string): string | null {
  const clean = ref.split(/[?#]/)[0];
  if (!clean || clean.startsWith("data:")) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    report.error(`${what} ${JSON.stringify(ref)}: undecodable path`);
    return null;
  }
  const base = decoded.startsWith("/") ? gameDir : path.dirname(path.join(gameDir, from));
  const abs = path.resolve(base, decoded.replace(/^\/+/, ""));
  const root = realpathSync(gameDir);
  if (!existsSync(abs)) {
    report.error(`${what} ${JSON.stringify(ref)}: missing asset (no such file in the game folder)`);
    return null;
  }
  const real = realpathSync(abs);
  if (real !== root && !real.startsWith(root + path.sep)) {
    report.error(`${what} ${JSON.stringify(ref)}: points outside the game folder`);
    return null;
  }
  if (!statSync(real).isFile()) {
    report.error(`${what} ${JSON.stringify(ref)}: not a file`);
    return null;
  }
  return real;
}

/** Package-style path of a resolved (real) file, relative to the real game folder. */
function relativeTo(gameDir: string, realFile: string): string {
  return path.relative(realpathSync(gameDir), realFile).split(path.sep).join("/");
}

function dataUri(file: string): string {
  return `data:${mimeTypeOf(file)};base64,${readFileSync(file).toString("base64")}`;
}

function formatMessage(m: Message): string {
  const loc = m.location ? ` (${m.location.file}:${m.location.line})` : "";
  return `${m.text}${loc}`;
}

/**
 * esbuild plugin applying the remote-resource policy to every import, dynamic
 * import, CSS @import and url() that esbuild encounters, and confining local
 * resolution to the game folder.
 */
function policyPlugin(gameDir: string, adapter: GameAdapter, report: InlineReport): Plugin {
  const droppable = new Set((adapter.dropRemoteHosts ?? []).map((h) => h.toLowerCase()));
  const root = realpathSync(gameDir);
  return {
    name: "hpg-policy",
    setup(b) {
      // Bare specifiers the entry's import map sends to a CDN ("three",
      // "three/addons/…"): the vendored copy, or a clear error.
      b.onResolve({ filter: /.*/ }, (args) => {
        if (!report.importMap.size || /^(\.{0,2}\/|[a-z][a-z0-9+.-]*:)/i.test(args.path)) return undefined;
        const url = importMapUrl(args.path, report.importMap);
        if (!url) return undefined;
        const hit = report.vendored(url);
        return hit ? { path: hit.file } : { errors: [{ text: `import map sends ${args.path} to ${url}, which is not vendored (hpg/vendor)` }] };
      });
      // HallPass's own co-op SDK, by site URL or root-relative path: bundle the
      // repo's copy (see HALLPASS_P2P_SDK_PATHS).
      b.onResolve({ filter: /hallpass-p2p(\.min)?\.js/ }, (args) => {
        const local = p2pSdkFile(args.path, report.publicDir);
        if (!local) return undefined;
        report.warn(`bundled the HallPass co-op SDK from public${HALLPASS_P2P_SDK_PATHS.find((p) => local.endsWith(p.split("/").join(path.sep)))} (co-op needs the internet; the game runs solo offline)`);
        return { path: local };
      });
      b.onResolve({ filter: /^(https?:)?\/\//i }, (args) => {
        const hit = report.vendored(args.path);
        if (hit) return { path: hit.file };
        const host = hostOf(args.path);
        if (droppable.has(host)) {
          report.dropped.add(host);
          report.warn(`dropped remote ${args.kind === "url-token" ? "file" : "import"} from ${host} (cosmetic; falls back offline)`);
          return { path: args.path, namespace: "hpg-dropped" };
        }
        return { errors: [{ text: `remote dependency ${args.path} cannot be packaged for offline play` }] };
      });
      b.onLoad({ filter: /.*/, namespace: "hpg-dropped" }, (args) => ({
        contents: "",
        loader: args.path.match(/\.(css)(\?|$)/) || args.path.includes("fonts.googleapis.com") ? "css" : "empty",
      }));
      // Module files: resolve import(CONST) first (const-imports.ts).
      b.onLoad({ filter: /\.m?js$/ }, (args) => {
        const code = readFileSync(args.path, "utf8");
        const out = inlineConstImports(code);
        return out === code ? undefined : { contents: out, loader: "js", resolveDir: path.dirname(args.path) };
      });
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.hpgChecked || args.namespace === "hpg-dropped") return undefined;
        if (args.kind === "entry-point") return undefined;
        const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { hpgChecked: true } });
        if (r.errors.length) return { errors: r.errors };
        if (r.external || !r.path) return r;
        const real = existsSync(r.path) ? realpathSync(r.path) : r.path;
        if (real !== root && !real.startsWith(root + path.sep) && !report.vendor?.contains(real)) {
          return { errors: [{ text: `import ${args.path} resolves outside the game folder` }] };
        }
        return r;
      });
    },
  };
}

type BundleKind = "esm" | "iife" | "css";

/**
 * Bundle one JS or CSS input with the package rules. Returns the code, or
 * `null` after reporting errors. Unbundleable dynamic imports are errors:
 * offline, a chunk that is not in the bundle cannot be fetched.
 */
export async function bundle(
  input: { file: string } | { contents: string; resolveDir: string; loader: "js" | "css"; sourcefile: string },
  kind: BundleKind,
  gameDir: string,
  relPath: string,
  adapter: GameAdapter,
  report: InlineReport,
): Promise<string | null> {
  try {
    const result = await build({
      ...("file" in input
        ? { entryPoints: [input.file] }
        : {
            stdin: {
              contents: input.loader === "js" ? inlineConstImports(input.contents) : input.contents,
              resolveDir: input.resolveDir,
              loader: input.loader,
              sourcefile: input.sourcefile,
            },
          }),
      bundle: true,
      write: false,
      minify: true,
      sourcemap: false,
      legalComments: "inline",
      platform: "browser",
      target: TARGET,
      format: kind === "css" ? undefined : kind,
      loader: { ...DATA_URI_LOADERS },
      define: kind === "css" ? undefined : { "import.meta.url": JSON.stringify(`hpg:/${relPath}`) },
      logLevel: "silent",
      absWorkingDir: gameDir,
      plugins: [policyPlugin(gameDir, adapter, report)],
    });
    for (const w of result.warnings) report.warn(`${relPath}: ${formatMessage(w)}`);
    const code = result.outputFiles[0]?.text ?? "";
    // esbuild leaves imports it cannot analyse (import(name)) in place with no
    // warning; find them in the output instead.
    if (kind !== "css") checkBundledCode(code, relPath, kind === "esm" ? "module" : "script", report);
    return code;
  } catch (e) {
    const errors = (e as { errors?: Message[] }).errors;
    if (errors?.length) for (const m of errors) report.error(`${relPath}: ${formatMessage(m)}`);
    else report.error(`${relPath}: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

async function minifyClassic(code: string, label: string, report: InlineReport): Promise<string | null> {
  // A classic script's top-level names are globals other scripts may use, so
  // it is minified WITHOUT bundling or wrapping (esbuild keeps top-level names
  // when no output format is set).
  try {
    const { transform } = await import("esbuild");
    const r = await transform(code, { loader: "js", minify: true, target: TARGET, legalComments: "inline", logLevel: "silent" });
    checkBundledCode(r.code, label, "script", report);
    return r.code;
  } catch (e) {
    const errors = (e as { errors?: Message[] }).errors;
    report.error(`${label}: ${errors?.map(formatMessage).join("; ") ?? String(e)}`);
    return null;
  }
}

/** The local file for a HallPass P2P SDK URL or root path, if it exists. */
function p2pSdkFile(spec: string, publicDir: string | undefined): string | null {
  if (!publicDir) return null;
  const clean = spec.split(/[?#]/)[0];
  let p: string;
  if (clean.startsWith("/") && !clean.startsWith("//")) p = clean;
  else {
    try {
      const u = new URL(clean.startsWith("//") ? `https:${clean}` : clean);
      if (!HALLPASS_HOSTS.includes(u.hostname)) return null;
      p = u.pathname;
    } catch {
      return null;
    }
  }
  if (!HALLPASS_P2P_SDK_PATHS.includes(p)) return null;
  const file = path.join(publicDir, ...p.split("/").filter(Boolean));
  return existsSync(file) ? file : null;
}

function isSdkScript(src: string): boolean {
  const clean = src.split(/[?#]/)[0];
  if (HALLPASS_SDK_PATHS.includes(clean)) return true;
  if (!isRemote(clean)) return false;
  try {
    const u = new URL(clean.startsWith("//") ? `https:${clean}` : clean);
    return HALLPASS_HOSTS.includes(u.hostname) && HALLPASS_SDK_PATHS.includes(u.pathname);
  } catch {
    return false;
  }
}

export type InlineResult = { html: string; usesSdk: boolean };

export async function inlineEntry(gameDir: string, entry: string, adapter: GameAdapter, report: InlineReport): Promise<InlineResult | null> {
  const entryPath = path.join(gameDir, entry);
  if (!existsSync(entryPath)) {
    report.error(`entry ${entry} does not exist`);
    return null;
  }
  // A silent console: jsdom's CSS parser complains about modern syntax it does
  // not know, which says nothing about whether the game packages.
  const dom = new JSDOM(readFileSync(entryPath, "utf8"), { virtualConsole: new VirtualConsole() });
  const doc = dom.window.document;
  // Import maps: a bare import ("three") mapped to a CDN shows up later as an
  // unresolvable import; name the real cause up front.
  // Remote entries are kept for the bundler when hpg/vendor has a pinned copy
  // of everything they point at.
  for (const el of [...doc.querySelectorAll('script[type="importmap"]')]) {
    let imports: Record<string, unknown> = {};
    try {
      imports = (JSON.parse(el.textContent ?? "{}") as { imports?: Record<string, unknown> }).imports ?? {};
    } catch {
      report.error("the import map is not valid JSON");
    }
    for (const [spec, url] of Object.entries(imports)) {
      if (typeof url !== "string" || !isRemote(url)) continue;
      // A hash mismatch counts as covered here; resolving the import reports it.
      const covered = spec.endsWith("/") ? report.vendor?.coversPrefix(url) : report.vendor?.has(url);
      if (covered) report.importMap.set(spec, url);
      else report.error(`import map maps a module to ${hostOf(url)} (${url}), which cannot be packaged for offline play`);
    }
    el.remove();
  }
  const droppable = new Set((adapter.dropRemoteHosts ?? []).map((h) => h.toLowerCase()));
  let usesSdk = false;

  const remoteRef = (el: Element, url: string, what: string): "dropped" | "error" => {
    const host = hostOf(url);
    if (droppable.has(host)) {
      report.dropped.add(host);
      report.warn(`dropped remote ${what} from ${host} (cosmetic; falls back offline)`);
      el.remove();
      return "dropped";
    }
    report.error(`remote ${what} ${url} cannot be packaged for offline play`);
    return "error";
  };

  // Scripts, in document order.
  for (const el of [...doc.querySelectorAll("script")]) {
    const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
    const src = el.getAttribute("src");
    const isModule = type === "module";
    if (!JS_TYPES.has(type)) continue; // shaders, JSON, templates: data, kept verbatim
    if (src !== null) {
      if (isSdkScript(src)) {
        usesSdk = true;
        report.info("replaced the networked HallPass SDK script with the offline SDK");
        el.remove();
        continue;
      }
      const hit = isRemote(src) ? report.vendored(src) : null;
      if (isRemote(src) && !hit) {
        remoteRef(el, src, "script");
        continue;
      }
      const file = hit?.file ?? resolveLocal(gameDir, entry, src, report, "script");
      if (!file) continue;
      const rel = hit ? `vendor:${hit.url}` : relativeTo(gameDir, file);
      const code = isModule
        ? await bundle({ file }, "esm", gameDir, rel, adapter, report)
        : await minifyClassic(readFileSync(file, "utf8"), rel, report);
      if (code === null) continue;
      const inline = doc.createElement("script");
      if (isModule) inline.setAttribute("type", "module");
      inline.textContent = code;
      el.replaceWith(inline);
      continue;
    }
    const code = el.textContent ?? "";
    if (!code.trim()) continue;
    const out = isModule
      ? await bundle({ contents: code, resolveDir: path.dirname(entryPath), loader: "js", sourcefile: `${entry}#inline-module` }, "esm", gameDir, entry, adapter, report)
      : await minifyClassic(code, `${entry} inline script`, report);
    if (out !== null) el.textContent = out;
  }

  // Stylesheets and style blocks.
  for (const el of [...doc.querySelectorAll("link")]) {
    const rel = (el.getAttribute("rel") ?? "").toLowerCase().split(/\s+/);
    const href = el.getAttribute("href") ?? "";
    if (rel.includes("stylesheet")) {
      const hit = isRemote(href) ? report.vendored(href) : null;
      if (isRemote(href) && !hit) {
        remoteRef(el, href, "stylesheet");
        continue;
      }
      const file = hit?.file ?? resolveLocal(gameDir, entry, href, report, "stylesheet");
      if (!file) continue;
      const css = await bundle({ file }, "css", gameDir, hit ? `vendor:${hit.url}` : relativeTo(gameDir, file), adapter, report);
      if (css === null) continue;
      const style = doc.createElement("style");
      style.textContent = css;
      el.replaceWith(style);
    } else if (rel.some((r) => ["preconnect", "dns-prefetch", "manifest", "modulepreload", "preload", "prefetch"].includes(r))) {
      el.remove();
    } else if (rel.includes("icon") || rel.includes("apple-touch-icon")) {
      if (href.startsWith("data:")) continue;
      if (isRemote(href)) {
        el.remove();
        report.info(`removed remote icon ${hostOf(href)}`);
        continue;
      }
      const file = resolveLocal(gameDir, entry, href, report, "icon");
      if (file) el.setAttribute("href", dataUri(file));
    }
  }
  for (const el of [...doc.querySelectorAll("style")]) {
    const css = el.textContent ?? "";
    if (!css.trim()) continue;
    const out = await bundle({ contents: css, resolveDir: path.dirname(entryPath), loader: "css", sourcefile: `${entry}#style` }, "css", gameDir, entry, adapter, report);
    if (out !== null) el.textContent = out;
  }

  // Media referenced from markup become data: URIs (a parser-set src never
  // passes through the guest's hpg:/ setter, so it must be self-contained).
  for (const [selector, attr] of [
    ["img[src]", "src"],
    ["audio[src]", "src"],
    ["video[src]", "src"],
    ["video[poster]", "poster"],
    ["source[src]", "src"],
    ["input[type=image][src]", "src"],
  ] as const) {
    for (const el of [...doc.querySelectorAll(selector)]) {
      const ref = el.getAttribute(attr) ?? "";
      if (!ref || ref.startsWith("data:") || ref.startsWith("blob:")) continue;
      if (isRemote(ref)) {
        remoteRef(el, ref, `<${el.tagName.toLowerCase()}>`);
        continue;
      }
      const file = resolveLocal(gameDir, entry, ref, report, `<${el.tagName.toLowerCase()}>`);
      if (file) el.setAttribute(attr, dataUri(file));
    }
  }

  for (const el of [...doc.querySelectorAll("base[href]")]) {
    report.info("removed <base href> (it would redirect relative URLs)");
    el.remove();
  }
  for (const el of [...doc.querySelectorAll("iframe[src], frame[src], embed[src], object[data]")]) {
    report.error(`<${el.tagName.toLowerCase()}> embeds another document, which version 1 does not package`);
  }
  if (doc.querySelector('meta[http-equiv="Content-Security-Policy" i]')) {
    report.warn("the game sets a Content-Security-Policy; check it allows blob: and data: URLs");
  }

  const html = dom.serialize();
  scanRemoteMentions(html, adapter, report);
  return { html, usesSdk };
}

/** Hosts that appear in code as identifiers, not as fetched resources. */
const NAMESPACE_HOSTS = new Set([
  ...["www.w3.org", "w3.org", "jcgt.org", "github.com", "threejs.org", "mrdoob.com"],
  // Credits and doc links inside the vendored libraries (hpg/vendor).
  ...["tailwindcss.com", "evilmartians.com", "www.w3ctech.com", "twitter.com", "mths.be", "fontawesome.com", "discourse.threejs.org"],
]);

/**
 * REPORTING ONLY: list remote hosts still mentioned anywhere in the finished
 * document. A mention is not proof of a request (it may be a link, a credit or
 * an XML namespace), so it is a warning. It turns a silent offline failure into
 * a line in the build report that a human reads before marking the game
 * verified.
 */
function scanRemoteMentions(html: string, adapter: GameAdapter, report: InlineReport) {
  const droppable = new Set(adapter.dropRemoteHosts ?? []);
  const hosts = new Set<string>();
  for (const m of html.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const h = m[1].toLowerCase();
    if (!NAMESPACE_HOSTS.has(h) && !droppable.has(h) && !GOOGLE_FONT_HOSTS.includes(h)) hosts.add(h);
  }
  for (const h of hosts) report.warn(`code mentions remote host ${h}; confirm the game does not need it offline`);
}
