// @vitest-environment jsdom
/**
 * Handle storage + sanitisation. Anonymous players get a stable auto `Guest#NNNN`
 * name (never a prompt); an explicit handle overrides and is sanitised; the `#`
 * character survives sanitisation so generated Guest names are preserved.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureHandle, generateGuestHandle, sanitizeHandle } from "./handle";

/** "Guest#" followed by exactly four digits. */
const GUEST = /^Guest#\d{4}$/;

/**
 * This repo's jsdom ships a non-functional `localStorage` (its methods are not
 * callable), which the SDK tolerates by design. Install a real in-memory
 * implementation so handle persistence is actually exercised here.
 */
function installMemoryStorage(): void {
  const store = new Map<string, string>();
  const mock: Storage = {
    get length(): number {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    removeItem: (key: string) => {
      store.delete(key);
    },
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: mock,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  installMemoryStorage();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("generateGuestHandle", () => {
  it("returns 'Guest#' + four digits in the 1000..9999 range", () => {
    for (let i = 0; i < 50; i++) {
      const handle = generateGuestHandle();
      expect(handle).toMatch(GUEST);
      const n = Number(handle.slice("Guest#".length));
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThanOrEqual(9999);
    }
  });
});

describe("sanitizeHandle", () => {
  it("preserves a '#' so a Guest name survives", () => {
    expect(sanitizeHandle("Guest#4821")).toBe("Guest#4821");
    expect(sanitizeHandle("Wild#Cat!!")).toBe("Wild#Cat");
  });
});

describe("ensureHandle", () => {
  it("mints a stable Guest# handle when nothing is stored and persists it", () => {
    const promptSpy = vi.fn();
    vi.stubGlobal("prompt", promptSpy);

    const handle = ensureHandle();

    expect(handle).toMatch(GUEST);
    // Persisted so it survives across sessions.
    expect(window.localStorage.getItem("hallpass:handle")).toBe(handle);
    // Anonymous players are NEVER prompted.
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("returns the SAME stored Guest handle on a later call (stability)", () => {
    const first = ensureHandle();
    const second = ensureHandle();

    expect(first).toMatch(GUEST);
    expect(second).toBe(first);
  });

  it("uses an explicit opts.handle (sanitised) without persisting it", () => {
    const result = ensureHandle({ handle: "Wild#Cat!!" });

    expect(result).toBe("Wild#Cat");
    // The explicit override is for this call only — nothing was persisted.
    expect(window.localStorage.getItem("hallpass:handle")).toBeNull();
  });

  it("never calls window.prompt, even with promptHandle set", () => {
    const promptSpy = vi.fn();
    vi.stubGlobal("prompt", promptSpy);

    ensureHandle();
    ensureHandle({ promptHandle: true });

    expect(promptSpy).not.toHaveBeenCalled();
  });
});
