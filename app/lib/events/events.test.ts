import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { countdownAt } from "./countdown";
import { describe, expect, it, vi } from "vitest";
import { eventBootScript } from "./boot";
import { FRIGHT_FEST_THEME } from "./fright-fest";
import { isExcludedPath, parseEventLook, resolveEvent } from "./look";
import { phaseAt } from "./phase";
import type { ThemeWindow } from "./types";

const T = FRIGHT_FEST_THEME;
const START = Date.parse(T.startAt);
const END = Date.parse(T.endAt);
const OPENS = Date.parse(T.opensAt ?? T.startAt);

describe("phaseAt", () => {
  it("is off before, live from the first millisecond, ended from the last", () => {
    expect(phaseAt(T, START - 1)).toBe("off");
    expect(phaseAt(T, START)).toBe("live");
    expect(phaseAt(T, END - 1)).toBe("live");
    expect(phaseAt(T, END)).toBe("ended");
  });

  it("is UTC: the skin paints 25 Oct 00:00Z to 2 Nov 00:00Z, the event opens 28 Oct", () => {
    expect(START).toBe(Date.UTC(2026, 9, 25));
    expect(OPENS).toBe(Date.UTC(2026, 9, 28));
    expect(END).toBe(Date.UTC(2026, 10, 2));
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
      expect(resolveEvent(T, { ...base, savedTheme })).toEqual({ live: true, on: true, theme: "dark" });
    }
  });

  it("an explicit Light gets Haunted Light", () => {
    expect(resolveEvent(T, { ...base, savedTheme: "light" })).toEqual({ live: true, on: true, theme: "light" });
  });

  it("the event look wins over the saved theme, and normal turns the skin off", () => {
    expect(resolveEvent(T, { ...base, savedTheme: "light", eventLook: "dark" })).toEqual({ live: true, on: true, theme: "dark" });
    expect(resolveEvent(T, { ...base, savedTheme: "dark", eventLook: "light" })).toEqual({ live: true, on: true, theme: "light" });
    expect(resolveEvent(T, { ...base, eventLook: "normal" })).toEqual({ live: true, on: false });
  });

  it("ignores the event look outside the window and on excluded paths", () => {
    expect(resolveEvent(T, { ...base, nowMs: START - 1, eventLook: "dark" })).toMatchObject({ on: false });
    expect(resolveEvent(T, { ...base, nowMs: END, eventLook: "dark" })).toMatchObject({ on: false });
    expect(resolveEvent(T, { ...base, path: "/dashboard/x" })).toMatchObject({ on: false });
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
      if (!r.live) {
        expect(attrs).toEqual({});
      } else if (!r.on) {
        expect(attrs).toEqual({ "data-hp-event": "fright-fest", "data-hp-event-phase": "live" });
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
  function walkSrc(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      if (name === "node_modules" || name === ".next") continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walkSrc(p, out);
      else if (/\.(tsx?|css)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
  }
  const APP = join(__dirname, "..", "..");
  const rel = (f: string) => f.slice(APP.length + 1);
  const THEME = [...walkSrc(join(APP, "lib/events")), ...walkSrc(join(APP, "components/events"))];
  const CHAMPIONSHIP = [...walkSrc(join(APP, "lib/championship")), ...walkSrc(join(APP, "components/championship"))];
  /** Shared catalogue and layout files the skin decorates: they may not read the championship switch. */
  const SHARED = ["components/GameCard.tsx", "components/GameListRow.tsx", "components/GameEventPanel.tsx", "layout.tsx"].map((f) =>
    join(APP, f),
  );

  it("no theme or skin file imports anything from the championship", () => {
    const offenders = THEME.filter((f) => /from\s+["'][^"']*championship[^"']*["']/.test(readFileSync(f, "utf8")));
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no championship module imports the theme", () => {
    const offenders = CHAMPIONSHIP.filter((f) =>
      /from\s+["'][^"']*(?:lib\/events|components\/events|\.\.\/events)\/[^"']*["']/.test(readFileSync(f, "utf8")),
    );
    expect(CHAMPIONSHIP.length).toBeGreaterThan(3);
    expect(offenders.map(rel)).toEqual([]);
  });

  it("no theme, skin or shared catalogue file reads the championship switch", () => {
    const offenders = [...THEME, ...SHARED].filter((f) =>
      /championshipEnabled|championshipBoard|FRIGHT_FEST_2026\b/.test(readFileSync(f, "utf8")),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("the skin's resolution is identical whatever the championship switch says", async () => {
    // Theme state comes from the clock; the championship cannot reach
    // resolveEvent, and this proves it by flipping the switch under it.
    const states: Array<[string, number]> = [
      ["off", START - 1],
      ["on", live],
      ["expired", END + 1],
    ];
    const before = states.map(([, nowMs]) => resolveEvent(T, { ...base, nowMs }));
    for (const enabled of [true, false]) {
      vi.resetModules();
      vi.doMock("../championship/config", () => ({
        championshipEnabled: () => enabled,
        championshipBoard: () => undefined,
        CHAMPIONSHIPS: [],
      }));
      const look = await import("./look");
      const after = states.map(([, nowMs]) => look.resolveEvent(T, { ...base, nowMs }));
      vi.doUnmock("../championship/config");
      expect(after).toEqual(before);
    }
    expect(before.map((r) => r.on)).toEqual([false, true, false]);
  });
});

describe("countdownAt", () => {
  const W = { ...T, enabled: true };
  it("counts to the opening, then the end, then stops", () => {
    expect(countdownAt(W, OPENS - 90_061_000)).toEqual({ to: "start", d: 1, h: 1, m: 1, s: 1 });
    expect(countdownAt(W, START)).toEqual({ to: "start", d: 3, h: 0, m: 0, s: 0 });
    expect(countdownAt(W, OPENS)?.to).toBe("end");
    expect(countdownAt(W, END - 1000)).toEqual({ to: "end", d: 0, h: 0, m: 0, s: 1 });
    expect(countdownAt(W, END)).toBeNull();
  });
  it("is null when disabled", () => {
    expect(countdownAt({ ...W, enabled: false }, START - 1000)).toBeNull();
  });
  it("opens with the skin when opensAt is omitted, and is null when it falls outside the window", () => {
    expect(countdownAt({ ...W, opensAt: undefined }, START)?.to).toBe("end");
    expect(countdownAt({ ...W, opensAt: "2026-10-20T00:00:00Z" }, START - 1000)).toBeNull();
    expect(countdownAt({ ...W, opensAt: W.endAt }, START - 1000)).toBeNull();
    expect(countdownAt({ ...W, opensAt: "nope" }, START - 1000)).toBeNull();
  });
});
