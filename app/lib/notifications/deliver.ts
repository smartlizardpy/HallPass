/**
 * HallPass — actually delivering a notification.
 *
 * The ONE place that decides what gets filed in a bell and what leaves the
 * browser as a push. Every producer calls a function here and nothing else: no
 * route inserts a notification row itself, and nothing but this module talks to
 * `push/send.ts` any more.
 *
 * ── NOTHING HERE MAY THROW ─────────────────────────────────────────────────
 * Every caller is a path that has ALREADY COMMITTED the thing being announced —
 * a challenge written, a friend request accepted, a review posted, a game marked
 * new. A notification that does not get filed is somebody missing an
 * announcement; a throw would turn a successful action into an apparent failure
 * and invite the player to retry something that already happened. The second is
 * far worse. This is the same contract `push/send.ts` states for the transport,
 * raised one level so the producer does not have to remember it.
 *
 * That is also why every one of these is `void`-returning and safe to `await`
 * directly at a call site: awaiting resolves once delivery has been ATTEMPTED,
 * and there is no failure to handle because there is no failure to report.
 *
 * ── THE COPY IS BUILT ONCE AND USED TWICE ──────────────────────────────────
 * The stored row and the pushed payload carry the SAME title and body, from the
 * same {@link NotificationCopy}. Deriving them separately is how a notification
 * comes to say one thing in the inbox and another on a lock screen — and the
 * lock screen version is the one with the safety argument attached.
 *
 * ── A DEDUPED EVENT DOES NOT PUSH ──────────────────────────────────────────
 * Push is sent only when the bell row was actually WRITTEN. A producer that
 * re-fires an event with the same `dedupeKey` — marking a game New, un-marking
 * it, marking it again — files nothing and therefore buzzes nobody. Without that
 * link the row would be deduped and the phone would go off every time, which is
 * the worse half of the pair to get wrong.
 */

import "server-only";
import { notificationPush } from "@/app/lib/push/payload";
import { sendPushToPlayers } from "@/app/lib/push/send";
import {
  deliversToBell,
  deliversToPush,
  kindDef,
  notificationTag,
  resolveChannel,
  type NotificationKind,
} from "./config";
import type { NotificationCopy } from "./copy";
import { notifications } from "./index";
import { adminPlayerIds } from "./admins";

/** What every producer supplies. */
type DeliveryInput = {
  kind: NotificationKind;
  copy: NotificationCopy;
  /**
   * Optional identity for the event, so re-firing it is a no-op.
   *
   * SCOPED PER RECIPIENT for the personal kinds — see {@link personalKey}. A
   * caller supplies the event's identity ("this game has been announced") and
   * never has to think about who is receiving it.
   */
  dedupeKey?: string | null;
};

/**
 * Scope a producer's dedupe key to one recipient.
 *
 * `notifications.dedupe_key` is unique across the WHOLE table, which is right
 * for a broadcast — there is one row — and wrong for a fan-out: an admin
 * notification keyed `review:42` would insert for whichever admin happened to be
 * first and silently drop every other admin on the roster. Suffixing the
 * recipient makes the key mean "this event, for this person", which is the unit
 * that actually needs to be idempotent.
 */
function personalKey(dedupeKey: string | null | undefined, playerId: string) {
  return dedupeKey ? `${dedupeKey}:${playerId}` : null;
}

/** Build the wire payload for a kind from its copy and its catalogue entry. */
function pushPayloadFor(kind: NotificationKind, copy: NotificationCopy) {
  const def = kindDef(kind);
  return notificationPush({
    kind,
    title: copy.title,
    body: copy.body,
    url: copy.url,
    // The catalogue guarantees this; `??` only narrows the type for a kind that
    // cannot reach here, since every caller is checked against the same table.
    discreet: def?.discreet ?? "You have a new notification.",
    tag: notificationTag(kind),
  });
}

/**
 * File one notification for one player, and push it if they asked for that.
 *
 * A kind switched OFF writes nothing at all — not a hidden row, not a filtered
 * one. `index.ts` also filters the backlog on read, so "off" reads the same
 * looking backwards and forwards; this is what stops the table accruing rows
 * nobody will ever be shown.
 */
export async function notifyPlayer(
  playerId: string,
  input: DeliveryInput,
): Promise<void> {
  try {
    if (!kindDef(input.kind)) return;

    const stored = await notifications
      .prefsFor(playerId)
      .catch(() => ({}) as Record<string, string>);
    const channel = resolveChannel(input.kind, stored[input.kind]);
    if (!deliversToBell(channel)) return;

    const written = await notifications.insertPersonal({
      playerId,
      kind: input.kind,
      title: input.copy.title,
      body: input.copy.body,
      url: input.copy.url,
      dedupeKey: personalKey(input.dedupeKey, playerId),
    });

    // Deduped: already filed once, so it has already been announced.
    if (!written) return;
    if (!deliversToPush(channel)) return;

    await sendPushToPlayers([playerId], pushPayloadFor(input.kind, input.copy));
  } catch (error) {
    console.error(`[notifications] notifyPlayer(${input.kind}) failed:`, error);
  }
}

/**
 * File one notification for EVERY current admin.
 *
 * The roster is resolved at send time (see `admins.ts`), so somebody removed
 * from `dashboard_users` stops being told with no cleanup step.
 *
 * Preferences for the whole roster come back in ONE query rather than one per
 * admin: this runs behind a player's review being posted, and a moderation
 * event should not cost a round trip per member of staff.
 */
export async function notifyAdmins(input: DeliveryInput): Promise<void> {
  try {
    const def = kindDef(input.kind);
    if (!def) return;
    // A broadcast row has no owner and is readable by every signed-in player, so
    // it could never carry an admin-only kind. `config.test.ts` asserts the
    // catalogue never pairs the two; this is the runtime half of that.
    if (def.scope !== "personal") return;

    const admins = await adminPlayerIds();
    if (admins.length === 0) return;

    const stored = await notifications
      .channelsForKind(admins, input.kind)
      .catch(() => ({}) as Record<string, string>);

    const pushTo: string[] = [];
    await Promise.all(
      admins.map(async (playerId) => {
        const channel = resolveChannel(input.kind, stored[playerId]);
        if (!deliversToBell(channel)) return;

        const written = await notifications.insertPersonal({
          playerId,
          kind: input.kind,
          title: input.copy.title,
          body: input.copy.body,
          url: input.copy.url,
          dedupeKey: personalKey(input.dedupeKey, playerId),
        });

        if (written && deliversToPush(channel)) pushTo.push(playerId);
      }),
    );

    // One batch for the whole roster rather than a send inside the loop above,
    // so the VAPID setup and the payload encoding happen once.
    await sendPushToPlayers(pushTo, pushPayloadFor(input.kind, input.copy));
  } catch (error) {
    console.error(`[notifications] notifyAdmins(${input.kind}) failed:`, error);
  }
}

/**
 * File one SITE-WIDE notification — a single row with no owner, which every
 * signed-in player reads.
 *
 * ── THE ROW IS WRITTEN WHATEVER ANYBODY'S PREFERENCES SAY ──────────────────
 * There is one row and thousands of readers, so there is no per-player decision
 * to make at write time. Whether a given player SEES it is decided on read, in
 * `index.ts`, against the same catalogue defaults. That is not a weaker
 * guarantee than the personal path — it is the only place the question can be
 * answered, since the answer differs per reader for one shared row.
 *
 * ── PUSH IS OPT-IN, AND NARROWED BEFORE IT IS SENT ─────────────────────────
 * `broadcastPushPlayerIds` returns only players who both want this kind pushed
 * AND have a device subscribed — a much smaller set than "everybody". Handing
 * the whole player table to the transport would be a device lookup per account
 * on the site for a single game drop.
 */
export async function notifyEveryone(input: DeliveryInput): Promise<void> {
  try {
    const def = kindDef(input.kind);
    if (!def) return;
    // Symmetry with `notifyAdmins`: a personal kind sent this way would have no
    // owner and would be shown to the whole site.
    if (def.scope !== "broadcast") return;

    const written = await notifications.insertBroadcast({
      kind: input.kind,
      title: input.copy.title,
      body: input.copy.body,
      url: input.copy.url,
      dedupeKey: input.dedupeKey ?? null,
    });
    // Already announced. Marking a game New, un-marking it and marking it again
    // is one drop, and must be one buzz.
    if (!written) return;

    const targets = await notifications
      .broadcastPushPlayerIds(input.kind, def.defaultChannel === "push")
      .catch((error) => {
        console.error("[notifications] broadcastPushPlayerIds failed:", error);
        return [] as string[];
      });

    await sendPushToPlayers(targets, pushPayloadFor(input.kind, input.copy));
  } catch (error) {
    console.error(`[notifications] notifyEveryone(${input.kind}) failed:`, error);
  }
}
