import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { ObjectUrlPool } from "../host/urls";
import { buildGuestRuntime, buildLauncherHtml } from "./launcher";

const SRC = path.resolve(__dirname, "..");

describe("buildLauncherHtml", () => {
  it("produces one self-contained page with the runtime and trust list baked in", async () => {
    const trust = { packages: [{ id: "alpha", version: "1.0.0+abcd1234", manifestDigest: "f".repeat(64) }] };
    const html = await buildLauncherHtml(SRC, trust);
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toContain("/*HPG:STYLE*/");
    expect(html).not.toContain("/*HPG:SCRIPT*/");
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"/);
    expect(html).toContain("f".repeat(64));
    expect(html).toContain("Content-Security-Policy");
    expect(html.match(/<script>/g)).toHaveLength(1);
    expect(html.length).toBeLessThan(200 * 1024);
  });

  it("builds a guest runtime that is safe to inline", async () => {
    const js = await buildGuestRuntime(SRC);
    expect(js).not.toMatch(/<\/script/i);
    expect(js).toContain("__HPG_BOOT__");
  });
});

describe("ObjectUrlPool", () => {
  it("mints once per key and revokes by prefix and on teardown", () => {
    let n = 0;
    const api = { createObjectURL: vi.fn(() => `blob:${++n}`), revokeObjectURL: vi.fn() };
    const pool = new ObjectUrlPool(api);
    const blob = () => new Blob(["x"]);
    expect(pool.get("a:1", blob)).toBe("blob:1");
    expect(pool.get("a:1", blob)).toBe("blob:1");
    pool.get("b:1", blob);
    expect(api.createObjectURL).toHaveBeenCalledTimes(2);
    pool.release("a:");
    expect(api.revokeObjectURL).toHaveBeenCalledWith("blob:1");
    expect(pool.size).toBe(1);
    pool.releaseAll();
    expect(api.revokeObjectURL).toHaveBeenCalledWith("blob:2");
    expect(pool.size).toBe(0);
  });
});
