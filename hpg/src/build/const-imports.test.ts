import { describe, expect, it } from "vitest";
import { inlineConstImports } from "./const-imports";

describe("inlineConstImports", () => {
  it("substitutes a top-level const string into import()", () => {
    const code = `const U="https://x.test/a.js",n=1;async function f(){return import(U)}`;
    expect(inlineConstImports(code)).toBe(`const U="https://x.test/a.js",n=1;async function f(){return import("https://x.test/a.js")}`);
  });

  it("handles exported consts and several imports", () => {
    expect(inlineConstImports(`export const A="./a.js";import(A);import(A);`)).toBe(`export const A="./a.js";import("./a.js");import("./a.js");`);
  });

  it("leaves a name that is bound anywhere else alone (it may be shadowed)", () => {
    for (const code of [
      `const U="./a.js";function f(U){return import(U)}`,
      `const U="./a.js";{let U="./b.js";import(U)}`,
      `const U="./a.js";try{}catch(U){import(U)}`,
      `const U="./a.js";const f=({U})=>import(U)`,
      `const U="./a.js";class U2{};const g=function U(){};import(U)`,
    ]) {
      expect(inlineConstImports(code)).toBe(code);
    }
  });

  it("leaves let, non-string and computed values alone", () => {
    for (const code of [`let U="./a.js";import(U)`, `const U=1;import(U)`, `const U="./"+x;import(U)`, `import(x)`]) {
      expect(inlineConstImports(code)).toBe(code);
    }
  });

  it("returns unparseable code unchanged", () => {
    expect(inlineConstImports(`const U="a";import(U`)).toBe(`const U="a";import(U`);
  });
});
