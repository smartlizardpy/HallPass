/**
 * HallPass — what a push notification looks like on the wire.
 *
 * PURE. No database, no `window`, no clock — so the shape, which is the part
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
 *
 * ── THIS MODULE NO LONGER KNOWS WHAT A CHALLENGE IS ────────────────────────
 * It used to build the challenge wording itself, back when a challenge was the
 * only thing that could push. The wording for every kind now lives in
 * `notifications/copy.ts` — one file, so the rules that apply across all of them
 * are checkable side by side — and the discreet counterpart in
 * `notifications/config.ts`, next to the kind it belongs to.
 *
 * What is left here is the ENVELOPE: the exact object `public/sw.js` reads. The
 * worker's contract is `{ full, discreet, url, tag }` and it renders `full` or
 * `discreet` by the mirrored flag and nothing else. Keeping the envelope in one
 * typed builder is what stops a producer hand-rolling a payload that is missing
 * a branch — the worker drops a payload without both, so a typo there would be
 * silence rather than an error.
 */

/** One rendering of the notification, as the service worker renders it. */
export type NotificationCopy = {
  title: string;
  body: string;
};

/**
 * A push, ready to encrypt.
 *
 * `full` and `discreet` are BOTH populated; `sw.js` picks one by the device's
 * mirrored preference and renders it. `url` is where a tap lands.
 */
export type NotificationPush = {
  kind: string;
  full: NotificationCopy;
  discreet: NotificationCopy;
  url: string;
  tag: string;
};

/**
 * The name the discreet version shows, for every kind.
 *
 * A CONSTANT, not something a caller may vary. A discreet title that changed
 * with the kind would leak by shape — a bystander seeing "HallPass" one moment
 * and "Moderation" the next learns more than either banner says on its own, and
 * the same argument already rules out a different ICON for the quiet version
 * over in `sw.js`.
 */
const DISCREET_TITLE = "HallPass";

/**
 * Build the envelope for one notification.
 *
 * The caller supplies the full wording (from `notifications/copy.ts`) and the
 * discreet BODY (from the kind's catalogue entry). It supplies neither the
 * discreet title nor any way to skip the discreet version — both would be the
 * shape of mistake this indirection exists to prevent.
 */
export function notificationPush(input: {
  kind: string;
  title: string;
  body: string;
  url: string;
  /** The kind's discreet body. Names nobody and nothing — see `config.ts`. */
  discreet: string;
  /** Per-kind, so one kind's banner cannot replace another's. */
  tag: string;
}): NotificationPush {
  return {
    kind: input.kind,
    full: { title: input.title, body: input.body },
    discreet: { title: DISCREET_TITLE, body: input.discreet },
    url: input.url,
    tag: input.tag,
  };
}
