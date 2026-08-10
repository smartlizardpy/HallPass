/**
 * HallPass — what a challenge notification says.
 *
 * PURE. No database, no `window`, no clock — so the wording, which is the part
 * with a safety argument attached, unit-tests in the plain `node` environment.
 *
 * ── THE PAYLOAD CARRIES BOTH VERSIONS, AND THE DEVICE PICKS ────────────────
 * A service worker CANNOT READ `localStorage`, and that is where stealth
 * preferences live (`hp:stealth`). The `push` event also fires with no tab open
 * at all, so there is nobody to ask. The options were:
 *
 *   (a) store the discreet preference server-side and redact before sending;
 *   (b) send both versions and let the service worker choose, reading a flag
 *       mirrored into IndexedDB, which a worker CAN read.
 *
 * (b) wins on the thing that actually matters: THE PREFERENCE IS PER-DEVICE. The
 * same person wants full detail on their own phone and discretion on the school
 * Chromebook, and a server-side per-account setting necessarily gets one of them
 * wrong. It also keeps `app/lib/stealth` free of a backend, which is its whole
 * design.
 *
 * What that costs is honest and small: the full text is inside the encrypted
 * payload on every push. Web Push payloads are encrypted to the subscription's
 * own keys and decrypted only on the subscribed device, and the threat this
 * feature guards against is somebody GLANCING AT A SCREEN — not somebody reading
 * ciphertext. Redacting at display time is the right layer for that threat.
 *
 * ── WHY THE DEFAULT IS THE LOUD ONE ────────────────────────────────────────
 * Full detail by default, discretion opt-in from stealth settings. A phone is a
 * personal device and a vague notification wastes the feature for most people.
 * The site does carry a real tension here — it has a panic key and tab cloaks
 * precisely so nobody can see what somebody is playing, and a banner reading
 * "Ozan challenged you on Duskfall" during a lesson works against that — which
 * is why the quiet version exists at all and lives where "hide what I'm doing"
 * already lives.
 */

import { CHALLENGE_NOTIFICATION_TAG } from "./config";

/** One rendering of the notification. */
export type NotificationCopy = {
  title: string;
  body: string;
};

/**
 * A challenge push, ready to encrypt.
 *
 * `full` and `discreet` are BOTH populated; `sw.js` picks one by the device's
 * mirrored preference and renders it. `url` is where a tap lands.
 */
export type ChallengePush = {
  kind: "challenge";
  full: NotificationCopy;
  discreet: NotificationCopy;
  url: string;
  tag: string;
};

/** Trim and bound a name so a long handle cannot push the verb off the banner. */
function shortName(name: string): string {
  const clean = name.trim();
  if (clean.length === 0) return "A friend";
  return clean.length > 24 ? `${clean.slice(0, 23)}…` : clean;
}

/**
 * Build the notification for "somebody challenged you".
 *
 * THE DISCREET VERSION NAMES NOBODY AND NOTHING. Not the sender, not the game,
 * not the score — because the person who switched it on did so to stop a
 * bystander learning any of those. "You have a new challenge" is enough to make
 * them open the site, which is all a notification needs to do.
 *
 * The full version names the sender and the game but still omits the score:
 * the number belongs on the page, where it comes with a Play button.
 */
export function challengeNotification(input: {
  from: string;
  /**
   * The game's DISPLAY TITLE ("Neon Velocity"), never its slug. A slug reads as
   * "Beat their score on neon-velocity-hyperdrive", which is the sort of thing
   * that looks fine in a test fixture and wrong on a lock screen. The caller
   * resolves it; `null` falls back to the board title.
   */
  game: string | null;
  boardTitle: string;
}): ChallengePush {
  const from = shortName(input.from);
  const where = input.game ?? input.boardTitle;

  return {
    kind: "challenge",
    full: {
      title: `${from} challenged you`,
      body: where ? `Beat their score on ${where}.` : "Beat their score.",
    },
    discreet: {
      // Named only "HallPass" — no sender, no game. Anyone glancing at the
      // screen learns that an app they may not recognise has something waiting.
      title: "HallPass",
      body: "You have a new challenge.",
    },
    // The inbox rather than the game: a challenge might be one of several, and
    // this is the screen that can show all of them with a way to act on each.
    url: "/play/friends",
    tag: CHALLENGE_NOTIFICATION_TAG,
  };
}
