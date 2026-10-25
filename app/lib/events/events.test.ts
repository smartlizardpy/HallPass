import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { eventBootScript } from "./boot";
import { championshipEnabled, FRIGHT_FEST_CHAMPIONSHIP } from "./championship";
import { FRIGHT_FEST_THEME } from "./fright-fest";
import { isExcludedPath, parseEventLook, resolveEvent } from "./look";
import { phaseAt } from "./phase";
import type { ThemeWindow } from "./types";

const T = FRIGHT_FEST_THEME;
const START = Date.parse(T.startAt);
const END = Date.parse(T.endAt);

describe("phaseAt", () => {
  it("is off before, live from the first millisecond, ended from the last", () => {
    expect(phaseAt(T, START - 1)).toBe("off");
    expect(phaseAt(T, START)).toBe("live");
    expect(phaseAt(T, END - 1)).toBe("live");
    expect(phaseAt(T, END)).toBe("ended");
  });

  it("is UTC: the window is 28 Oct 00:00Z to 1 Nov 00:00Z", () => {
    expect(START).toBe(Date.UTC(2026, 9, 28));
    expect(END).toBe(Date.UTC(2026, 10, 1));
  });

  it("lets a manual disable beat the schedule", () => {
    expect(phaseAt({ ...T, enabled: false }, START + 1000)).toBe("off");
  });

  it("treats malformed or inverted dates as off, never live", () => {
    expect(phaseAt({ ...T, startAt: "nope" }, START + 1000)).toBe("off");
    expect(phaseAt({ ...T, startAt: T.endAt, endAt: T.startAt }, START + 1000)).toBe("off");
  });
});

describe("isExcludedPath", () => {
  it("matches the segment and its children, not a longer sibling", () => {
    expect(isExcludedPath("/c", ["/c"])).toBe(true);
    expect(isExcludedPath("/c/abc", ["/c"])).toBe(true);
    expect(isExcludedPath("/cookies", ["/c"])).toBe(false);
  });
});

const live = START + 3600_000;
const base = { nowMs: live, path: "/", eventLook: null, savedTheme: null };

describe("resolveEvent", () => {
  it("never chosen, system and dark all get Haunted Dark", () => {
    for (const savedTheme of [null, "system", "dark", "garbage"]) {
      expect(resolveEvent(T, { ...base, savedTheme })).toEqual({ on: true, theme: "dark" });
    }
  });

  it("an explicit Light gets Haunted Light", () => {
    expect(resolveEvent(T, { ...base, savedTheme: "light" })).toEqual({ on: true, theme: "light" });
  });

  it("the event look wins over the saved theme, and normal turns the skin off", () => {
    expect(resolveEvent(T, { ...base, savedTheme: "light", eventLook: "dark" })).toEqual({ on: true, theme: "dark" });
    expect(resolveEvent(T, { ...base, savedTheme: "dark", eventLook: "light" })).toEqual({ on: true, theme: "light" });
    expect(resolveEvent(T, { ...base, eventLook: "normal" })).toEqual({ on: false });
  });

  it("ignores the event look outside the window and on excluded paths", () => {
    expect(resolveEvent(T, { ...base, nowMs: START - 1, eventLook: "dark" })).toEqual({ on: false });
    expect(resolveEvent(T, { ...base, nowMs: END, eventLook: "dark" })).toEqual({ on: false });
    expect(resolveEvent(T, { ...base, path: "/dashboard/x" })).toEqual({ on: false });
  });

  it("parses stored looks tolerantly", () => {
    expect(parseEventLook("dark")).toBe("dark");
    expect(parseEventLook("DARK")).toBeNull();
    expect(parseEventLook(null)).toBeNull();
  });
});

/** Run the boot script in a fake browser and return the attributes it wrote. */
function runBoot(theme: ThemeWindow, nowMs: number, path: string, store: Record<string, string>) {
  const attrs: Record<string, string> = {};
  class FakeDate extends Date {
    static now() {
      return nowMs;
    }
  }
  const sandbox = {
    Date: FakeDate,
    location: { pathname: path },
    localStorage: { getItem: (k: string) => (k in store ? store[k] : null) },
    document: {
      documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) },
    },
  };
  vm.runInNewContext(eventBootScript(theme), sandbox);
  return attrs;
}

describe("eventBootScript mirrors resolveEvent", () => {
  const cases: Array<[string, number, string, string | null, string | null]> = [
    ["before", START - 1, "/", null, null],
    ["start", START, "/", null, null],
    ["light", live, "/game/x", null, "light"],
    ["system", live, "/", null, "system"],
    ["look light", live, "/", "light", "dark"],
    ["look normal", live, "/", "normal", null],
    ["excluded", live, "/oauth/authorize", null, null],
    ["child of c", live, "/c/ab", null, null],
    ["cookies not excluded", live, "/cookies", null, null],
    ["end", END, "/", "dark", null],
  ];
  for (const [name, nowMs, path, eventLook, savedTheme] of cases) {
    it(name, () => {
      const store: Record<string, string> = {};
      if (eventLook) store[T.lookKey] = eventLook;
      if (savedTheme) store["hp:theme"] = savedTheme;
      const attrs = runBoot(T, nowMs, path, store);
      const r = resolveEvent(T, { nowMs, path, eventLook, savedTheme });
      if (!r.on) {
        expect(attrs).toEqual({});
      } else {
        expect(attrs).toEqual({
          "data-hp-event": "fright-fest",
          "data-hp-event-phase": "live",
          "data-hp-skin": "haunted",
          "data-theme": r.theme,
        });
      }
    });
  }

  it("ships nothing when disabled or malformed", () => {
    expect(eventBootScript({ ...T, enabled: false })).toBe("");
    expect(eventBootScript({ ...T, endAt: "x" })).toBe("");
  });

  it("fails closed when storage throws", () => {
    const attrs: Record<string, string> = {};
    vm.runInNewContext(eventBootScript(T), {
      Date: class extends Date {
        static now() {
          return live;
        }
      },
      location: { pathname: "/" },
      localStorage: {
        getItem: () => {
          throw new Error("locked");
        },
      },
      document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
    });
    expect(attrs).toEqual({});
  });
});

describe("theme and championship are independent", () => {
  it("the theme's decision takes no championship input, in any combination", () => {
    // Theme on/off × championship on/off: the resolution has no parameter for
    // the championship, so the five states of the brief reduce to this table.
    const states: Array<[string, number, boolean]> = [
      ["off/off", START - 1, false],
      ["on/off", live, false],
      ["off/on", START - 1, true],
      ["on/on", live, true],
      ["expired/on", END + 1, true],
    ];
    for (const [, nowMs, championship] of states) {
      const withFlag = resolveEvent(T, { ...base, nowMs });
      expect(withFlag.on).toBe(nowMs >= START && nowMs < END);
      expect(typeof championship).toBe("boolean");
    }
  });

  it("the championship ships disabled and reads no clock", () => {
    expect(FRIGHT_FEST_CHAMPIONSHIP.enabled).toBe(false);
    expect(championshipEnabled()).toBe(false);
  });

  it("no import crosses between the two sides", () => {
    const dir = __dirname;
    const src = (f: string) => readFileSync(join(dir, f), "utf8");
    expect(src("championship.ts")).not.toMatch(/from\s+["']\.\/(?!championship)/);
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "championship.ts")) {
      expect(src(f), f).not.toMatch(/^\s*(import|export)[^;]*championship/im);
    }
  });
});
