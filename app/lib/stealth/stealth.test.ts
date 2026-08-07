import { describe, expect, it } from "vitest";
import { cloakById, CLOAK_LIST, DEFAULT_CLOAK_ID } from "./cloaks";
import { DEFAULT_PREFS, parsePrefs, serializePrefs } from "./store";
import { isPanicScreen } from "./config";

describe("cloakById", () => {
  it("resolves a known id to its preset", () => {
    expect(cloakById("docs").title).toBe("Untitled document - Google Docs");
  });

  it("falls back to the off preset for an unknown or nullish id", () => {
    expect(cloakById("does-not-exist").id).toBe(DEFAULT_CLOAK_ID);
    expect(cloakById(null).id).toBe(DEFAULT_CLOAK_ID);
    expect(cloakById(undefined).id).toBe(DEFAULT_CLOAK_ID);
  });

  it("the off preset keeps the real favicon (null) and leads the list", () => {
    expect(CLOAK_LIST[0].id).toBe(DEFAULT_CLOAK_ID);
    expect(cloakById("off").favicon).toBeNull();
  });

  it("every non-off preset ships an inline data-URI favicon", () => {
    for (const cloak of CLOAK_LIST) {
      if (cloak.id === "off") continue;
      expect(cloak.favicon).toMatch(/^data:image\/svg\+xml,/);
    }
  });
});

describe("parsePrefs", () => {
  it("returns a fresh copy of the defaults for null", () => {
    const prefs = parsePrefs(null);
    expect(prefs).toEqual(DEFAULT_PREFS);
    expect(prefs).not.toBe(DEFAULT_PREFS); // must not hand out the shared ref
  });

  it("returns defaults for malformed JSON", () => {
    expect(parsePrefs("{not json")).toEqual(DEFAULT_PREFS);
  });

  it("returns defaults for a non-object payload", () => {
    expect(parsePrefs("42")).toEqual(DEFAULT_PREFS);
    expect(parsePrefs("[]")).toEqual(DEFAULT_PREFS);
  });

  it("keeps valid fields and defaults the rest", () => {
    const prefs = parsePrefs(JSON.stringify({ cloak: "drive" }));
    expect(prefs.cloak).toBe("drive");
    expect(prefs.panicKey).toBe(DEFAULT_PREFS.panicKey);
    expect(prefs.panicScreen).toBe(DEFAULT_PREFS.panicScreen);
  });

  it("coerces an unknown cloak id back to off", () => {
    expect(parsePrefs(JSON.stringify({ cloak: "myspace" })).cloak).toBe("off");
  });

  it("rejects an empty panic key and an unknown panic screen", () => {
    const prefs = parsePrefs(JSON.stringify({ panicKey: "", panicScreen: "nope" }));
    expect(prefs.panicKey).toBe(DEFAULT_PREFS.panicKey);
    expect(prefs.panicScreen).toBe(DEFAULT_PREFS.panicScreen);
  });

  it("round-trips through serializePrefs", () => {
    const prefs = { cloak: "classroom", panicKey: "Escape", panicScreen: "search" } as const;
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });
});

describe("isPanicScreen", () => {
  it("accepts known screens and rejects others", () => {
    expect(isPanicScreen("docs")).toBe(true);
    expect(isPanicScreen("classroom")).toBe(true);
    expect(isPanicScreen("minesweeper")).toBe(false);
  });
});
