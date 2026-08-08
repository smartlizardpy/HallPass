import { describe, expect, it, vi } from "vitest";
import {
  isDisguiseTitle,
  lockOverflow,
  reconcileTitle,
  releaseOverflow,
  type OverflowTarget,
} from "./panic";
import { PANIC_SCREENS, panicScreenById } from "./config";
import { cloakById } from "./cloaks";

const REAL = "Snake · HALLPASS";
const DOCS_TITLE = cloakById("docs").title;
const SEARCH_TITLE = cloakById("search").title;

describe("isDisguiseTitle", () => {
  it("recognises every cloak title", () => {
    expect(isDisguiseTitle(DOCS_TITLE)).toBe(true);
    expect(isDisguiseTitle(cloakById("newtab").title)).toBe(true);
  });

  it("recognises every panic screen title", () => {
    for (const screen of PANIC_SCREENS) {
      expect(isDisguiseTitle(screen.title)).toBe(true);
    }
  });

  it("does not treat the real site title as a disguise", () => {
    expect(isDisguiseTitle(cloakById("off").title)).toBe(false);
    expect(isDisguiseTitle(REAL)).toBe(false);
  });
});

describe("reconcileTitle", () => {
  it("shows the disguise and remembers the real title it covered", () => {
    expect(reconcileTitle(REAL, DOCS_TITLE, "stale")).toEqual({
      real: REAL,
      title: DOCS_TITLE,
    });
  });

  it("never records another disguise's title as the real one", () => {
    // Raising the panic screen while the Docs cloak is on: the observed title is
    // already a disguise, so the memory of the real title must survive untouched.
    expect(reconcileTitle(DOCS_TITLE, SEARCH_TITLE, REAL)).toEqual({
      real: REAL,
      title: SEARCH_TITLE,
    });
  });

  it("restores the remembered title when the disguise drops", () => {
    expect(reconcileTitle(DOCS_TITLE, null, REAL)).toEqual({ real: REAL, title: REAL });
  });

  it("keeps a real title current while no disguise is up", () => {
    expect(reconcileTitle("Store · HALLPASS", null, REAL)).toEqual({
      real: "Store · HALLPASS",
      title: "Store · HALLPASS",
    });
  });

  it("picks up a navigation that happens behind a raised disguise", () => {
    // Next rewrote the title mid-panic; the disguise is re-asserted and the new
    // real title is what a later dismiss must restore.
    const first = reconcileTitle("Store · HALLPASS", DOCS_TITLE, REAL);
    expect(first).toEqual({ real: "Store · HALLPASS", title: DOCS_TITLE });
    expect(reconcileTitle(DOCS_TITLE, null, first.real).title).toBe("Store · HALLPASS");
  });

  it("is idempotent once the tab already reads what we want", () => {
    const once = reconcileTitle(REAL, DOCS_TITLE, REAL);
    expect(reconcileTitle(once.title, DOCS_TITLE, once.real)).toEqual(once);
  });
});

describe("lockOverflow / releaseOverflow", () => {
  const target = (overflow = ""): OverflowTarget => ({ style: { overflow } });

  it("clamps every target while locked", () => {
    const html = target();
    const body = target();
    lockOverflow([html, body], 0, 0);
    expect(html.style.overflow).toBe("hidden");
    expect(body.style.overflow).toBe("hidden");
  });

  it("restores an unset overflow to unset", () => {
    const el = target("");
    releaseOverflow(lockOverflow([el], 0, 0), () => {});
    expect(el.style.overflow).toBe("");
  });

  it("gives a nested lock back to the modal that was already holding it", () => {
    // The promo modal locks the body too; releasing ours must not unfreeze theirs.
    const el = target("hidden");
    releaseOverflow(lockOverflow([el], 0, 0), () => {});
    expect(el.style.overflow).toBe("hidden");
  });

  it("puts the player back where they were scrolled to", () => {
    const scrollTo = vi.fn();
    releaseOverflow(lockOverflow([target()], 12, 940), scrollTo);
    expect(scrollTo).toHaveBeenCalledWith(12, 940);
  });
});

describe("panicScreenById", () => {
  it("resolves a known id", () => {
    expect(panicScreenById("search").title).toBe(SEARCH_TITLE);
  });

  it("falls back to the default screen for an unknown or nullish id", () => {
    expect(panicScreenById("minesweeper").id).toBe("docs");
    expect(panicScreenById(null).id).toBe("docs");
    expect(panicScreenById(undefined).id).toBe("docs");
  });

  it("gives every screen a tab caption and an inline favicon", () => {
    for (const screen of PANIC_SCREENS) {
      expect(screen.title.length).toBeGreaterThan(0);
      expect(screen.favicon).toMatch(/^data:image\/svg\+xml,/);
    }
  });
});
