/**
 * Build the launcher into ONE standalone `index.html`.
 *
 *   guest/entry.ts   → esbuild IIFE, minified    → the in-frame runtime (a string)
 *   launcher/main.ts → esbuild IIFE, minified, with the runtime and the trust
 *                      list baked in via `define`
 *   launcher/styles.css → esbuild, minified
 *   → spliced into launcher/template.html at its two placeholders
 *
 * The template is OUR file, with exactly one `/*HPG:STYLE*\/` and one
 * `/*HPG:SCRIPT*\/` marker, so splicing it is not HTML parsing. Game HTML is
 * never treated this way (build/inline.ts).
 *
 * The result is checked before it is returned: no `</script` inside the
 * inlined code, and no remote URL anywhere (the only absolute URL allowed is
 * the SVG namespace).
 */

import { build } from "esbuild";
import { readFileSync } from "node:fs";
import path from "node:path";

export type TrustList = { packages: { id: string; version: string; manifestDigest: string }[] };

const TARGET = ["chrome100", "edge100", "firefox100", "safari15"];

async function bundleBrowser(entry: string, define?: Record<string, string>): Promise<string> {
  const r = await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    minify: true,
    sourcemap: false,
    format: "iife",
    platform: "browser",
    target: TARGET,
    legalComments: "none",
    charset: "utf8",
    define,
    logLevel: "silent",
  });
  return r.outputFiles[0].text;
}

export async function buildGuestRuntime(srcDir: string): Promise<string> {
  const js = await bundleBrowser(path.join(srcDir, "guest", "entry.ts"));
  if (/<\/script/i.test(js)) throw new Error("guest runtime contains </script");
  return js;
}

export async function buildLauncherHtml(srcDir: string, trust: TrustList): Promise<string> {
  const runtime = await buildGuestRuntime(srcDir);
  const app = await bundleBrowser(path.join(srcDir, "launcher", "main.ts"), {
    __HPG_RUNTIME__: JSON.stringify(runtime),
    __HPG_TRUST__: JSON.stringify(trust),
  });
  const cssResult = await build({
    entryPoints: [path.join(srcDir, "launcher", "styles.css")],
    bundle: true,
    write: false,
    minify: true,
    target: TARGET,
    logLevel: "silent",
  });
  const css = cssResult.outputFiles[0].text;
  if (/<\/script/i.test(app)) throw new Error("launcher bundle contains </script");
  if (/<\/style/i.test(css)) throw new Error("launcher styles contain </style");

  const template = readFileSync(path.join(srcDir, "launcher", "template.html"), "utf8");
  const parts = { style: template.split("/*HPG:STYLE*/"), script: template.split("/*HPG:SCRIPT*/") };
  if (parts.style.length !== 2 || parts.script.length !== 2) throw new Error("launcher template must contain each placeholder exactly once");
  const html = template.split("/*HPG:STYLE*/").join(css).split("/*HPG:SCRIPT*/").join(app);

  const remote = new Set([...html.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((m) => m[1].toLowerCase()));
  remote.delete("www.w3.org");
  if (remote.size) throw new Error(`launcher references remote hosts: ${[...remote].join(", ")}`);
  return html;
}
