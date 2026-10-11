// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { confirmIpNotice, NOTICE_KEY, resetNoticeState, showNoticeDialog } from "./notice";

/** The test env's own localStorage is unreliable (see the repo's other failing suites), so use a stub. */
function stubStorage(broken = false) {
  const m = new Map<string, string>();
  const boom = () => {
    throw new Error("blocked");
  };
  const store = {
    getItem: broken ? boom : (k: string) => m.get(k) ?? null,
    setItem: broken ? boom : (k: string, v: string) => void m.set(k, v),
  };
  vi.stubGlobal("localStorage", store);
  return store;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  stubStorage();
  resetNoticeState();
  document.body.innerHTML = "";
});

const dialog = () => document.querySelector("hallpass-p2p-notice")?.shadowRoot ?? null;
const click = (cls: string) => (dialog()!.querySelector(`button.${cls}`) as HTMLButtonElement).click();

describe("once per device", () => {
  it("asks the first time, remembers Continue, and does not ask again", async () => {
    const show = vi.fn().mockResolvedValue(true);
    expect(await confirmIpNotice(show)).toBe(true);
    expect(localStorage.getItem(NOTICE_KEY)).toBe("1");
    resetNoticeState(); // a new page load: only localStorage remains
    expect(await confirmIpNotice(show)).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("does not remember Cancel: the next attempt asks again", async () => {
    const show = vi.fn().mockResolvedValue(false);
    expect(await confirmIpNotice(show)).toBe(false);
    expect(localStorage.getItem(NOTICE_KEY)).toBeNull();
    expect(await confirmIpNotice(show)).toBe(false);
    expect(show).toHaveBeenCalledTimes(2);
  });

  it("two simultaneous connects share one dialog", async () => {
    let resolve!: (v: boolean) => void;
    const show = vi.fn(() => new Promise<boolean>((r) => (resolve = r)));
    const a = confirmIpNotice(show);
    const b = confirmIpNotice(show);
    resolve(true);
    expect(await Promise.all([a, b])).toEqual([true, true]);
    expect(show).toHaveBeenCalledTimes(1);
  });

  it("falls back to once per page session when storage throws", async () => {
    stubStorage(true);
    const show = vi.fn().mockResolvedValue(true);
    expect(await confirmIpNotice(show)).toBe(true);
    expect(await confirmIpNotice(show)).toBe(true);
    expect(show).toHaveBeenCalledTimes(1);
    resetNoticeState(); // next session: asked again
    expect(await confirmIpNotice(show)).toBe(true);
    expect(show).toHaveBeenCalledTimes(2);
  });
});

describe("the dialog", () => {
  it("is an accessible modal with the agreed wording, focused on Continue", async () => {
    const p = showNoticeDialog();
    const card = dialog()!.querySelector('[role="dialog"]')!;
    expect(card.getAttribute("aria-modal")).toBe("true");
    expect(dialog()!.getElementById("t")!.textContent).toBeTruthy();
    expect(dialog()!.getElementById("d")!.textContent).toBe(
      "Players in this room can see your IP address (it shows roughly where you are). Only play with people you know.",
    );
    expect(dialog()!.activeElement?.textContent).toBe("Continue");
    click("go");
    expect(await p).toBe(true);
    expect(dialog()).toBeNull();
  });

  it("Cancel resolves false and removes itself", async () => {
    const p = showNoticeDialog();
    click("no");
    expect(await p).toBe(false);
    expect(document.querySelector("hallpass-p2p-notice")).toBeNull();
  });

  it("Escape cancels, and the game does not see the key", async () => {
    const seen = vi.fn();
    document.addEventListener("keydown", seen);
    const p = showNoticeDialog();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));
    expect(await p).toBe(false);
    document.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("Tab cycles between the two buttons", async () => {
    const p = showNoticeDialog();
    const tab = () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", cancelable: true }));
    tab();
    expect(dialog()!.activeElement?.textContent).toBe("Cancel");
    tab();
    expect(dialog()!.activeElement?.textContent).toBe("Continue");
    click("no");
    await p;
  });
});
