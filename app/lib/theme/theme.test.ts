import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  isThemeChoice,
  nextThemeChoice,
  parseThemeChoice,
  resolveTheme,
  THEME_ATTR,
  THEME_KEY,
  THEME_OPTIONS,
} from "./config";
import { themeBootScript } from "./boot";

describe("parseThemeChoice", () => {
  it("keeps each of the three legal choices", () => {
    for (const option of THEME_OPTIONS) {
      expect(parseThemeChoice(option.id)).toBe(option.id);
    }
  });

  it("falls back to the default for nothing stored", () => {
    expect(parseThemeChoice(null)).toBe(DEFAULT_THEME);
    expect(parseThemeChoice(undefined)).toBe(DEFAULT_THEME);
    expect(parseThemeChoice("")).toBe(DEFAULT_THEME);
  });

  it("falls back to the default for a value an older or hostile build wrote", () => {
    expect(parseThemeChoice("DARK")).toBe(DEFAULT_THEME);
    expect(parseThemeChoice("midnight")).toBe(DEFAULT_THEME);
    expect(parseThemeChoice('{"choice":"dark"}')).toBe(DEFAULT_THEME);
  });
});

describe("isThemeChoice", () => {
  it("accepts only the three ids", () => {
    expect(isThemeChoice("system")).toBe(true);
    expect(isThemeChoice("light")).toBe(true);
    expect(isThemeChoice("dark")).toBe(true);
    expect(isThemeChoice("auto")).toBe(false);
  });
});

describe("resolveTheme", () => {
  it("defers to the device only for `system`", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });

  it("lets an explicit choice contradict the device — the point of having one", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("nextThemeChoice", () => {
  it("advances in list order and wraps", () => {
    expect(nextThemeChoice("system")).toBe("light");
    expect(nextThemeChoice("light")).toBe("dark");
    expect(nextThemeChoice("dark")).toBe("system");
  });

  it("visits every option exactly once per lap", () => {
    const seen = new Set<string>();
    let choice = DEFAULT_THEME;
    for (let i = 0; i < THEME_OPTIONS.length; i++) {
      seen.add(choice);
      choice = nextThemeChoice(choice);
    }
    expect(seen.size).toBe(THEME_OPTIONS.length);
    expect(choice).toBe(DEFAULT_THEME);
  });
});

describe("themeBootScript", () => {
  const script = themeBootScript();

  it("reads the same key and writes the same attribute the store uses", () => {
    expect(script).toContain(JSON.stringify(THEME_KEY));
    expect(script).toContain(JSON.stringify(THEME_ATTR));
  });

  it("is a self-contained IIFE that swallows its own errors", () => {
    expect(script.startsWith("(function(){try{")).toBe(true);
    expect(script.trimEnd().endsWith("}catch(e){}})();")).toBe(true);
  });

  it("never writes the preference back", () => {
    expect(script).not.toContain("setItem");
  });

  it("carries nothing that could close the inline <script> it is embedded in", () => {
    expect(script.toLowerCase()).not.toContain("</script");
  });

  /**
   * The script hand-rolls `resolveTheme` (it cannot import), so the two are
   * checked against each other by RUNNING it against a fake document and a fake
   * `localStorage`/`matchMedia` — the same four states the resolver is tested on
   * above, plus the corrupt-value case.
   */
  function runBoot(stored: string | null, systemPrefersDark: boolean): string | null {
    let written: string | null = null;
    const sandbox = {
      localStorage: { getItem: (key: string) => (key === THEME_KEY ? stored : null) },
      window: {
        matchMedia: (query: string) => ({ matches: systemPrefersDark && query.includes("dark") }),
      },
      document: {
        documentElement: {
          setAttribute: (name: string, value: string) => {
            if (name === THEME_ATTR) written = value;
          },
        },
      },
    };
    new Function("localStorage", "window", "document", script)(
      sandbox.localStorage,
      sandbox.window,
      sandbox.document,
    );
    return written;
  }

  it("resolves exactly as `resolveTheme` does", () => {
    expect(runBoot("dark", false)).toBe("dark");
    expect(runBoot("light", true)).toBe("light");
    expect(runBoot("system", true)).toBe("dark");
    expect(runBoot("system", false)).toBe("light");
  });

  it("treats an absent or corrupt value as `system`", () => {
    expect(runBoot(null, true)).toBe("dark");
    expect(runBoot(null, false)).toBe("light");
    expect(runBoot("midnight", true)).toBe("dark");
    expect(runBoot("midnight", false)).toBe("light");
  });

  it("leaves the attribute unset when the browser refuses — CSS covers that", () => {
    let written: string | null = null;
    const throwing = {
      getItem() {
        throw new Error("storage disabled");
      },
    };
    const doc = {
      documentElement: {
        setAttribute: (_name: string, value: string) => {
          written = value;
        },
      },
    };
    new Function("localStorage", "window", "document", script)(throwing, {}, doc);
    expect(written).toBeNull();
  });
});
