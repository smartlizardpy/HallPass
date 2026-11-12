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
 * | any other remote resource               | BUILD ERROR                                     |
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
import { GOOGLE_FONT_HOSTS, HALLPASS_HOSTS, HALLPASS_SDK_PATHS, type GameAdapter } from "./adapter";
import { checkBundledCode } from "./js-check";

export type BuildIssue = { level: "error" | "warning" | "info"; message: string };

export class InlineReport {
  issues: BuildIssue[] = [];
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
const TARGET = ["es2020"];
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
      b.onResolve({ filter: /^(https?:)?\/\//i }, (args) => {
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
      b.onResolve({ filter: /.*/ }, async (args) => {
        if (args.pluginData?.hpgChecked || args.namespace === "hpg-dropped") return undefined;
        if (args.kind === "entry-point") return undefined;
        const r = await b.resolve(args.path, { kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { hpgChecked: true } });
        if (r.errors.length) return { errors: r.errors };
        if (r.external || !r.path) return r;
        const real = existsSync(r.path) ? realpathSync(r.path) : r.path;
        if (real !== root && !real.startsWith(root + path.sep)) {
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
        : { stdin: { contents: input.contents, resolveDir: input.resolveDir, loader: input.loader, sourcefile: input.sourcefile } }),
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
  for (const el of [...doc.querySelectorAll('script[type="importmap"]')]) {
    const remote = (el.textContent ?? "").match(/https?:\/\/[a-z0-9.-]+/gi) ?? [];
    for (const url of new Set(remote)) report.error(`import map maps a module to ${url}, which cannot be packaged for offline play`);
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
      if (isRemote(src)) {
        remoteRef(el, src, "script");
        continue;
      }
      const file = resolveLocal(gameDir, entry, src, report, "script");
      if (!file) continue;
      const rel = relativeTo(gameDir, file);
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
      if (isRemote(href)) {
        remoteRef(el, href, "stylesheet");
        continue;
      }
      const file = resolveLocal(gameDir, entry, href, report, "stylesheet");
      if (!file) continue;
      const css = await bundle({ file }, "css", gameDir, relativeTo(gameDir, file), adapter, report);
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
const NAMESPACE_HOSTS = new Set(["www.w3.org", "w3.org", "jcgt.org", "github.com", "threejs.org", "mrdoob.com"]);

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
