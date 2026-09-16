// @vitest-environment jsdom
/**
 * Handle storage + sanitisation. Anonymous players get a stable auto
 * `SigmaAlphaMale#NNNN` name (never a prompt); an explicit handle overrides and
 * is sanitised; a generated name survives being read back, length cap included,
 * which is what keeps a returning guest on one leaderboard row.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureHandle, generateGuestHandle, sanitizeHandle } from "./handle";

/** The generated stem followed by exactly four digits. */
const GUEST = /^SigmaAlphaMale#\d{4}$/;
/** Kept in one place so the round-trip tests below cannot drift from it. */
const STEM = "SigmaAlphaMale";

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
  it("returns the stem + four digits in the 1000..9999 range", () => {
    for (let i = 0; i < 50; i++) {
      const handle = generateGuestHandle();
      expect(handle).toMatch(GUEST);
      const n = Number(handle.slice(`${STEM}#`.length));
      expect(n).toBeGreaterThanOrEqual(1000);
      expect(n).toBeLessThanOrEqual(9999);
    }
  });
});

describe("sanitizeHandle", () => {
  it("preserves a '#' in a typed handle", () => {
    expect(sanitizeHandle("Wild#Cat!!")).toBe("Wild#Cat");
  });

  it("round-trips a generated name whole, past the typed-input cap", () => {
    // The name this file mints is longer than MAX_LEN and is read back through
    // here on every later session. Truncating it would rename the player
    // mid-session and split them into two leaderboard rows, since the server
    // identifies a guest by their handle string.
    const minted = generateGuestHandle();
    expect(minted.length).toBeGreaterThan(12);
    expect(sanitizeHandle(minted)).toBe(minted);
  });

  it("still caps anything that merely looks like a generated name", () => {
    expect(sanitizeHandle(`${STEM}#48210`)).toHaveLength(12);
    expect(sanitizeHandle(`${STEM}#abcd`)).toHaveLength(12);
    expect(sanitizeHandle(STEM)).toHaveLength(12);
  });
});

describe("ensureHandle", () => {
  it("mints a stable generated handle when nothing is stored and persists it", () => {
    const promptSpy = vi.fn();
    vi.stubGlobal("prompt", promptSpy);

    const handle = ensureHandle();

    expect(handle).toMatch(GUEST);
    // Persisted so it survives across sessions.
    expect(window.localStorage.getItem("hallpass:handle")).toBe(handle);
    // Anonymous players are NEVER prompted.
    expect(promptSpy).not.toHaveBeenCalled();
  });

  it("returns the SAME stored handle on a later call (stability)", () => {
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
