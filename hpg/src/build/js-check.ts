/**
 * Find code that would try to LOAD something at run time after bundling.
 *
 * WHY THIS IS AN AST PASS. esbuild inlines every import it can resolve, but an
 * import it cannot analyse, such as `import(name)` with a computed `name`, is
 * left in the output with NO warning (checked against esbuild 0.27). Offline,
 * that line would go to the network and fail at the moment the player reaches
 * it. Parsing the finished output and listing every surviving `import(…)`,
 * static `import`/`export … from`, and esbuild's `__require` shim turns that
 * silent failure into a build error naming the code.
 */

import { parse, type Node } from "acorn";
import type { InlineReport } from "./inline";

type AnyNode = Node & Record<string, unknown>;

function isAllowedSource(n: unknown): boolean {
  const lit = n as { type?: string; value?: unknown };
  return lit?.type === "Literal" && typeof lit.value === "string" && /^(data|blob):/i.test(lit.value);
}

export function findRuntimeLoads(code: string, sourceType: "module" | "script"): { ok: true; loads: string[] } | { ok: false; error: string } {
  let ast: Node;
  try {
    ast = parse(code, { ecmaVersion: "latest", sourceType, allowHashBang: true, allowAwaitOutsideFunction: sourceType === "script" });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const loads: string[] = [];
  const snippet = (n: AnyNode) => code.slice(n.start, Math.min(n.end, n.start + 80));
  const stack: unknown[] = [ast];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const c of cur) stack.push(c);
      continue;
    }
    const n = cur as AnyNode;
    switch (n.type) {
      case "ImportExpression":
        if (!isAllowedSource(n.source)) loads.push(`dynamic import ${snippet(n)}`);
        break;
      case "ImportDeclaration":
      case "ExportAllDeclaration":
        loads.push(`static import ${snippet(n)}`);
        break;
      case "ExportNamedDeclaration":
        if (n.source) loads.push(`static import ${snippet(n)}`);
        break;
      case "CallExpression": {
        const callee = n.callee as { type?: string; name?: string };
        if (callee?.type === "Identifier" && callee.name === "__require") loads.push(`dynamic require ${snippet(n)}`);
        break;
      }
    }
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end" || key === "loc" || key === "range") continue;
      const v = n[key];
      if (v && typeof v === "object") stack.push(v);
    }
  }
  return { ok: true, loads };
}

/** Report every surviving runtime load in `code` as a build error. */
export function checkBundledCode(code: string, label: string, sourceType: "module" | "script", report: InlineReport): void {
  const r = findRuntimeLoads(code, sourceType);
  if (!r.ok) {
    report.warn(`${label}: could not be parsed for a dynamic-import check (${r.error})`);
    return;
  }
  for (const l of r.loads) report.error(`${label}: unsupported ${l} (it would load from the network at run time)`);
}
