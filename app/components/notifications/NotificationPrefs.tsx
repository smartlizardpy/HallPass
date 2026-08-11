"use client";

/**
 * HallPass — the per-kind notification switches.
 *
 * One three-way control per kind: Off, Bell, Push. The scale is the same three
 * `NOTIFICATION_CHANNELS` the server enforces, imported from the catalogue
 * rather than retyped, so what this offers cannot drift from what delivery
 * honours.
 *
 * ── IT SAVES PER ROW, NOT BEHIND A SAVE BUTTON ─────────────────────────────
 * Each switch PUTs its own kind. A form with one Save is the wrong shape here:
 * there is no valid combination to validate across rows, nothing is a draft, and
 * the failure mode of a batch — "three saved, one did not" — is a story this
 * page would have to tell and a single write simply does not have.
 *
 * ── IT IS OPTIMISTIC, AND IT ROLLS BACK ────────────────────────────────────
 * The switch moves on click and the request follows. A failed write puts it
 * BACK where it was and says so — silently keeping the new position would leave
 * somebody believing they had turned challenges off when the server still has
 * them on, which for a notification setting is the failure that matters: they
 * find out from a buzzing phone during a lesson.
 *
 * ── THE PROPS ARE ALREADY RESOLVED ─────────────────────────────────────────
 * `initial` carries the EFFECTIVE channel per kind — the stored deviation or the
 * catalogue default, decided server-side by `getResolvedPrefs`. This component
 * never applies a default itself, so there is exactly one place that knows what
 * "no opinion" means.
 */

import { useState } from "react";
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_GROUPS,
  NOTIFICATION_KINDS,
  type NotificationChannel,
  type NotificationKind,
} from "../../lib/notifications/config";

/** What each channel is called, and what picking it actually does. */
const CHANNEL_LABEL: Record<NotificationChannel, string> = {
  off: "Off",
  bell: "Bell",
  push: "Push",
};

const CHANNEL_HINT: Record<NotificationChannel, string> = {
  off: "Don't tell me at all",
  bell: "Show it in my bell",
  push: "Bell, and notify my devices",
};

export function NotificationPrefs({
  kinds,
  initial,
}: {
  /** The kinds this viewer may set — already filtered by audience server-side. */
  kinds: NotificationKind[];
  initial: Record<string, NotificationChannel>;
}) {
  const [channels, setChannels] = useState<Record<string, NotificationChannel>>(
    () => ({ ...initial }),
  );
  /** The kind whose last save failed, so one row can show an error in place. */
  const [failed, setFailed] = useState<string | null>(null);

  const choose = (kind: NotificationKind, next: NotificationChannel) => {
    const previous = channels[kind];
    if (previous === next) return;

    setChannels((current) => ({ ...current, [kind]: next }));
    setFailed(null);

    void fetch("/api/v1/me/notifications/prefs", {
      method: "PUT",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, channel: next }),
    })
      .then((res) => {
        if (res.ok) return;
        // Put it back. See the docblock — a switch that lies about a
        // notification setting is discovered by a phone going off in a lesson.
        setChannels((current) => ({ ...current, [kind]: previous }));
        setFailed(kind);
      })
      .catch(() => {
        setChannels((current) => ({ ...current, [kind]: previous }));
        setFailed(kind);
      });
  };

  // Only the groups that actually have a row for this viewer. An admin sees
  // Moderation; a player never sees the heading at all, rather than an empty
  // section that advertises kinds they cannot have.
  const groups = NOTIFICATION_GROUPS.filter((group) =>
    kinds.some((kind) => NOTIFICATION_KINDS[kind].group === group.id),
  );

  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <section
          key={group.id}
          className="rounded-xl border border-border bg-surface p-6"
        >
          <h3 className="text-sm font-black uppercase tracking-wide text-foreground">
            {group.label}
          </h3>
          <p className="mt-1 text-xs font-semibold text-muted">{group.blurb}</p>

          <ul className="mt-4 space-y-4">
            {kinds
              .filter((kind) => NOTIFICATION_KINDS[kind].group === group.id)
              .map((kind) => {
                const def = NOTIFICATION_KINDS[kind];
                const value = channels[kind] ?? def.defaultChannel;
                return (
                  <li
                    key={kind}
                    className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4 first:border-t-0 first:pt-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span aria-hidden className="text-base">
                          {def.icon}
                        </span>
                        <span className="text-sm font-bold text-foreground">
                          {def.label}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted">
                        {def.description}
                      </p>
                      {failed === kind && (
                        <p className="mt-1 text-xs font-bold text-red-900">
                          Couldn&rsquo;t save that — try again.
                        </p>
                      )}
                    </div>

                    {/* A radiogroup, not three buttons: these are one setting
                        with three values, and a screen reader should hear
                        "2 of 3" rather than three unrelated toggles. */}
                    <div
                      role="radiogroup"
                      aria-label={`${def.label} notifications`}
                      className="flex shrink-0 rounded-full border border-border bg-surface-2 p-0.5"
                    >
                      {NOTIFICATION_CHANNELS.map((channel) => {
                        const active = value === channel;
                        return (
                          <button
                            key={channel}
                            type="button"
                            role="radio"
                            aria-checked={active}
                            title={CHANNEL_HINT[channel]}
                            onClick={() => choose(kind, channel)}
                            className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition focus:outline-none focus-visible:ring-4 focus-visible:ring-brand/30 ${
                              active
                                ? "bg-brand text-white"
                                : "text-zinc-600 hover:text-zinc-900"
                            }`}
                          >
                            {CHANNEL_LABEL[channel]}
                          </button>
                        );
                      })}
                    </div>
                  </li>
                );
              })}
          </ul>
        </section>
      ))}
    </div>
  );
}
