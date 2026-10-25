/**
 * Fright Fest 2026 — THE THEME CONFIGURATION. This is the one place to edit.
 *
 * TO SWITCH THE HAUNTED SKIN OFF: set `enabled: false` and ship. It beats the
 * schedule. TO MOVE THE DATES: change `startAt` / `endAt` (UTC, with a `Z`).
 * NOTHING ELSE needs touching, and nothing here is read by the championship:
 * see `championship.ts`, which is deliberately a separate module with its own
 * flag. After `endAt` the skin stops painting by itself; no commit is reverted.
 *
 * Adding a later event (winter, spring) is a new file like this one, its own
 * `skin` name and its own `haunted.css` equivalent.
 */

import type { ThemeWindow } from "./types";

export const FRIGHT_FEST_THEME: ThemeWindow = {
  id: "fright-fest-2026-theme",
  enabled: true,
  startAt: "2026-10-28T00:00:00Z",
  endAt: "2026-11-01T00:00:00Z",
  event: "fright-fest",
  skin: "haunted",
  lookKey: "hp:event-look:fright-fest-2026",
  // Full-screen worlds and utility surfaces keep the permanent palette. Mirrors
  // MobileTabBar's HIDDEN_PREFIXES plus the raw-asset and third-party routes.
  excludedPaths: [
    "/dashboard",
    "/admin",
    "/beta",
    "/embed",
    "/oauth",
    "/offline",
    "/auth",
    "/c",
    "/i",
    "/game-html",
    "/game-media",
    "/play/signin",
    "/play/signout",
    "/play/welcome",
    "/play/auth",
  ],
};
