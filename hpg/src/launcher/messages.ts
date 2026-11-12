/**
 * Plain words for every failure a player can meet. Error codes come from
 * archive/zip.ts and archive/package.ts. The technical detail stays in a
 * collapsed "Details" line, and a stack trace is never shown.
 */

const MESSAGES: Record<string, string> = {
  untrusted: "This game wasn't built for this arcade. Download a fresh arcade from HallPass to play it.",
  "format-too-new": "This game needs a newer arcade. Download a fresh one from HallPass.",
  "launcher-too-old": "This game needs a newer arcade. Download a fresh one from HallPass.",
  "missing-manifest": "This isn't a HallPass game package.",
  "invalid-manifest": "This game package is broken. Download it again from HallPass.",
  "corrupt-archive": "This file is damaged. Download it again from HallPass.",
  "hash-mismatch": "This game has been changed or damaged since HallPass built it, so it won't run.",
  "size-mismatch": "This game has been changed or damaged since HallPass built it, so it won't run.",
  "missing-file": "This game package is incomplete. Download it again from HallPass.",
  "unexpected-file": "This game package contains files it shouldn't. It won't run.",
  limits: "This file is too large to be a HallPass game.",
  "too-many-entries": "This file has too many items in it to be a games collection.",
  "too-large": "This file is too large to be a games collection.",
  "entry-too-large": "This file is too large to be a games collection.",
  "suspicious-ratio": "This file unpacks to something far larger than it looks, so it was not opened.",
  "not-zip": "That's not a ZIP file. Choose games.zip from your arcade folder.",
  unsupported: "This ZIP file uses a format the arcade can't open. Use the games.zip from HallPass.",
  corrupt: "This file is damaged. Download it again from HallPass.",
  "crc-mismatch": "This file is damaged. Download it again from HallPass.",
  "unsafe-path": "This file contains unsafe names, so it was not opened.",
  "duplicate-path": "This file contains duplicate entries, so it was not opened.",
};

export function friendlyError(code: string, fallback = "Something went wrong reading this file."): string {
  return MESSAGES[code] ?? fallback;
}
