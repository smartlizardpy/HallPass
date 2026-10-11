// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { applyFavicon } from "./apply";

afterEach(() => {
  document.head.innerHTML = "";
});

describe("applyFavicon", () => {
  it("does not create an icon link just to restore the original", () => {
    applyFavicon(null);
    expect(document.head.querySelector("link")).toBeNull();
  });

  it("makes no head mutations when restoring with no icon present", async () => {
    // The controller re-runs this from a MutationObserver on <head>. A call that
    // mutates the head would re-fire the observer forever (it froze live pages).
    let batches = 0;
    const observer = new MutationObserver(() => {
      batches += 1;
      if (batches < 50) applyFavicon(null);
    });
    observer.observe(document.head, { childList: true, subtree: true, attributes: true });
    applyFavicon(null);
    await new Promise((r) => setTimeout(r, 20));
    observer.disconnect();
    expect(batches).toBe(0);
  });

  it("sets a disguise icon and restores the original href", () => {
    document.head.innerHTML = '<link rel="icon" href="/real.ico">';
    applyFavicon("data:image/svg+xml,x");
    const link = document.head.querySelector("link")!;
    expect(link.getAttribute("href")).toBe("data:image/svg+xml,x");
    applyFavicon(null);
    expect(link.getAttribute("href")).toBe("/real.ico");
  });
});
