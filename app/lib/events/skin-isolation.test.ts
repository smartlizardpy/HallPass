import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SKIN_DIR = join(ROOT, "components/events/fright-fest");
const HAUNTED = join(SKIN_DIR, "haunted.css");
const SKIN_FILES = readdirSync(SKIN_DIR).filter((f) => f.endsWith(".css")).map((f) => join(SKIN_DIR, f));
const BASE_TOKENS = [
  "--background", "--foreground", "--foreground-2", "--surface", "--surface-2",
  "--border", "--muted", "--brand", "--brand-50", "--brand-100", "--brand-600",
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".css")) out.push(p);
  }
  return out;
}

/** Top-level rule selectors, including those inside @media/@supports, skipping keyframe steps. */
function selectors(css: string): string[] {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: string[] = [];
  const stack: string[] = [];
  let buf = "";
  for (const ch of src) {
    if (ch === "{") {
      const head = buf.trim();
      buf = "";
      const inKeyframes = stack.some((h) => h.startsWith("@keyframes"));
      if (!head.startsWith("@") && !inKeyframes) out.push(head);
      stack.push(head);
    } else if (ch === "}") {
      stack.pop();
      buf = "";
    } else if (ch === ";") {
      buf = "";
    } else buf += ch;
  }
  return out;
}

describe("seasonal CSS isolation", () => {
  it("every selector in the skin stylesheets is scoped to the skin or event attribute", () => {
    expect(SKIN_FILES.length).toBeGreaterThan(1);
    const bad = SKIN_FILES.flatMap((f) => selectors(readFileSync(f, "utf8")))
      .flatMap((s) => s.split(","))
      .map((s) => s.trim())
      .filter((s) => !/^html\[data-hp-(skin|event)/.test(s));
    expect(bad).toEqual([]);
  });

  it("no other stylesheet assigns a base token under a seasonal selector", () => {
    const offenders: string[] = [];
    for (const file of walk(ROOT)) {
      if (file === HAUNTED) continue;
      const css = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      for (const m of css.matchAll(/([^{}]*data-hp-(?:skin|event)[^{}]*)\{([^{}]*)\}/g)) {
        for (const t of BASE_TOKENS) {
          if (new RegExp(`(^|[;\\s])${t}\\s*:`).test(m[2])) offenders.push(`${relative(ROOT, file)}: ${t}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("globals.css never mentions the seasonal attributes", () => {
    const css = readFileSync(join(ROOT, "globals.css"), "utf8");
    expect(css).not.toMatch(/data-hp-(skin|event)/);
  });
});
