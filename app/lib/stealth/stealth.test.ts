import { describe, expect, it } from "vitest";
import { cloakById, CLOAK_LIST, DEFAULT_CLOAK_ID } from "./cloaks";
import { DEFAULT_PREFS, parsePrefs, serializePrefs } from "./store";
import { isPanicScreen, STEALTH_KEY } from "./config";
import { cloakBootScript } from "./boot";

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

  it("defaults shake to off and keeps a stored boolean", () => {
    expect(parsePrefs(null).shake).toBe(false);
    expect(parsePrefs(JSON.stringify({ shake: true })).shake).toBe(true);
  });

  it("ignores a non-boolean shake value", () => {
    expect(parsePrefs(JSON.stringify({ shake: "yes" })).shake).toBe(DEFAULT_PREFS.shake);
    expect(parsePrefs(JSON.stringify({ shake: 1 })).shake).toBe(DEFAULT_PREFS.shake);
  });

  it("round-trips through serializePrefs", () => {
    const prefs = {
      cloak: "classroom",
      panicKey: "Escape",
      panicScreen: "search",
      shake: true,
      quietNotifications: true,
    } as const;
    expect(parsePrefs(serializePrefs(prefs))).toEqual(prefs);
  });

  it("defaults quiet notifications to OFF and keeps a stored boolean", () => {
    // Off out of the box, unlike the rest of this module: a phone is personal,
    // and a nameless notification wastes the feature for most people.
    expect(parsePrefs(null).quietNotifications).toBe(false);
    expect(
      parsePrefs(JSON.stringify({ quietNotifications: true })).quietNotifications,
    ).toBe(true);
  });

  it("reads a payload written before quiet notifications existed", () => {
    // The per-field fallback is what makes adding a preference backwards
    // compatible rather than a migration — every device already carries a
    // four-field payload.
    const old = JSON.stringify({
      cloak: "classroom",
      panicKey: "Escape",
      panicScreen: "search",
      shake: true,
    });
    expect(parsePrefs(old).quietNotifications).toBe(false);
    expect(parsePrefs(old).cloak).toBe("classroom");
  });
});

describe("isPanicScreen", () => {
  it("accepts known screens and rejects others", () => {
    expect(isPanicScreen("docs")).toBe(true);
    expect(isPanicScreen("classroom")).toBe(true);
    expect(isPanicScreen("minesweeper")).toBe(false);
  });
});

describe("cloakBootScript", () => {
  const script = cloakBootScript();

  it("is a self-invoking function wrapped in a try/catch", () => {
    expect(script.startsWith("(function(){try{")).toBe(true);
  });

  it("references the shared storage key so it reads the same prefs", () => {
    expect(script).toContain(STEALTH_KEY);
  });

  it("embeds the non-off cloak titles but not the off preset's data", () => {
    expect(script).toContain("Untitled document - Google Docs");
    // The off preset carries no disguise, so its title must not be in the map.
    expect(script).not.toContain("HALLPASS — Unblocked Games");
  });

  it("never contains a closing script tag that could break out of the inline script", () => {
    expect(script.toLowerCase()).not.toContain("</script");
  });
});
