/**
 * Turn `import(NAME)` into `import("literal")` when NAME is a top-level
 * `const NAME = "literal"`, so esbuild can resolve (and the packaging policy
 * can judge) an import whose URL a game keeps in a constant:
 *
 *   const SDK = "https://www.hallpass.games/sdk/p2p/v1/hallpass-p2p.js";
 *   const { HallPassP2P } = await import(SDK);
 *
 * Without this, esbuild leaves `import(SDK)` untouched and js-check.ts rightly
 * fails the build, because the target cannot be known.
 *
 * SOUNDNESS. Minified code reuses short names in inner scopes, so a name is
 * substituted only when it is bound EXACTLY ONCE in the whole file (counting
 * every variable, parameter, function, class, catch and import binding). Then
 * every reference to it is that one `const`, which cannot be reassigned.
 * Anything less certain is left alone and still fails the build loudly.
 * Parsed with acorn (no regex); edits are spliced by source position.
 */

import { parse, type Node } from "acorn";

type AnyNode = Node & Record<string, unknown>;

function bindingNames(pattern: unknown, out: string[]): void {
  const p = pattern as AnyNode | null;
  if (!p) return;
  switch (p.type) {
    case "Identifier":
      out.push(p.name as string);
      break;
    case "ObjectPattern":
      for (const prop of p.properties as AnyNode[]) bindingNames(prop.type === "RestElement" ? prop.argument : prop.value, out);
      break;
    case "ArrayPattern":
      for (const el of p.elements as unknown[]) bindingNames(el, out);
      break;
    case "RestElement":
      bindingNames(p.argument, out);
      break;
    case "AssignmentPattern":
      bindingNames(p.left, out);
      break;
  }
}

export function inlineConstImports(code: string): string {
  if (!code.includes("import(")) return code;
  let ast: AnyNode;
  try {
    ast = parse(code, { ecmaVersion: "latest", sourceType: "module" }) as unknown as AnyNode;
  } catch {
    return code; // esbuild will report the syntax error with better context
  }

  // Top-level `const NAME = "string"`.
  const consts = new Map<string, string>();
  for (const stmt of ast.body as AnyNode[]) {
    const decl = stmt.type === "ExportNamedDeclaration" ? (stmt.declaration as AnyNode | null) : stmt;
    if (decl?.type !== "VariableDeclaration" || decl.kind !== "const") continue;
    for (const d of decl.declarations as AnyNode[]) {
      const id = d.id as AnyNode;
      const init = d.init as AnyNode | null;
      if (id.type === "Identifier" && init?.type === "Literal" && typeof init.value === "string") consts.set(id.name as string, init.value);
    }
  }
  if (consts.size === 0) return code;

  // Every binding in the file, and every import(Identifier).
  const bound = new Map<string, number>();
  const bind = (names: string[]) => names.forEach((n) => bound.set(n, (bound.get(n) ?? 0) + 1));
  const imports: AnyNode[] = [];
  const stack: unknown[] = [ast];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object") continue;
    if (Array.isArray(cur)) {
      for (const c of cur) stack.push(c);
      continue;
    }
    const n = cur as AnyNode;
    const names: string[] = [];
    switch (n.type) {
      case "VariableDeclarator":
        bindingNames(n.id, names);
        break;
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        if (n.id) bindingNames(n.id, names);
        for (const prm of n.params as unknown[]) bindingNames(prm, names);
        break;
      case "ClassDeclaration":
      case "ClassExpression":
        if (n.id) bindingNames(n.id, names);
        break;
      case "CatchClause":
        bindingNames(n.param, names);
        break;
      case "ImportSpecifier":
      case "ImportDefaultSpecifier":
      case "ImportNamespaceSpecifier":
        bindingNames(n.local, names);
        break;
      case "ImportExpression":
        if ((n.source as AnyNode).type === "Identifier") imports.push(n);
        break;
    }
    bind(names);
    for (const key of Object.keys(n)) {
      if (key === "type" || key === "start" || key === "end") continue;
      const v = n[key];
      if (v && typeof v === "object") stack.push(v);
    }
  }

  const edits = imports
    .map((n) => n.source as AnyNode)
    .filter((src) => consts.has(src.name as string) && bound.get(src.name as string) === 1)
    .sort((a, b) => b.start - a.start);
  let out = code;
  for (const src of edits) out = out.slice(0, src.start) + JSON.stringify(consts.get(src.name as string)) + out.slice(src.end);
  return out;
}
