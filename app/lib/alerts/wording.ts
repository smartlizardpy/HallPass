/**
 * HallPass — turning a fired alert into the words an admin reads.
 *
 * PURE, and the join between two catalogues that deliberately do not import each
 * other: `rules.ts` knows what fired and with what numbers, `notifications/copy.ts`
 * knows how this site words a notification, and neither needs to know about the
 * other. One `switch`, exhaustive over the union, so adding an alert without
 * wording it is a TYPE ERROR rather than a notification that says nothing.
 *
 * ── THE SERVER WORDS ITS OWN NOTIFICATIONS ─────────────────────────────────
 * This is the reason the notify endpoint takes ids and numbers rather than a
 * title and a body. The credential that drives it lives in a GitHub repository's
 * settings, where anyone who can edit a workflow file can read it; if that
 * request carried the text, the worst case would be arbitrary words pushed to an
 * admin's lock screen. Because it carries a measurement instead, the worst case
 * is a spike that did not happen — an annoyance, not a foothold.
 */

import {
  contentGapCopy,
  errorSpikeCopy,
  trafficSpikeCopy,
  type NotificationCopy,
} from "@/app/lib/notifications/copy";
import type { FiredAlert } from "./rules";

/** What this alert says in a bell row and on a lock screen. */
export function alertCopy(alert: FiredAlert): NotificationCopy {
  switch (alert.id) {
    case "traffic_spike":
      return trafficSpikeCopy({ visitors: alert.visitors, ratio: alert.ratio });
    case "error_spike":
      return errorSpikeCopy({ errors: alert.errors, ratio: alert.ratio });
    case "content_gap":
      return contentGapCopy({ term: alert.term, people: alert.people });
  }
}
