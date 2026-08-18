"use client";

/**
 * The marketing LINK BUILDER — pick a destination and a channel, get a tagged
 * URL and an honest preview of what it will look like when it is pasted.
 *
 * Client-only for the clipboard and the two selects; every destination, and
 * whether it has a social image, is computed on the server and handed down as
 * props. Nothing about the catalogue is bundled into the page beyond the list.
 *
 * THE PREVIEW IS THE POINT, more than the URL is. Building `?ref=tiktok` by hand
 * is easy. What nobody does by hand is check what the link RENDERS as in the
 * place it is about to be pasted — and the answer for our most-shared URL is
 * currently "a bare grey rectangle", because the home grid has no
 * `opengraph-image` and neither do the category pages. That is a fact worth
 * meeting before a post goes out rather than after, so the preview states it
 * plainly instead of drawing a plausible-looking card that does not exist.
 *
 * Clipboard failure is not an error state, for the same reason as `CopyBox`: an
 * insecure context or a denied permission just means the field stays selectable
 * and the fallback is select-all.
 */

import { useMemo, useState } from "react";
import {
  DEFAULT_CHANNEL,
  channelNote,
  channelsByGroup,
  taggedUrl,
} from "@/app/lib/growth/channels";

export type Destination = {
  path: string;
  label: string;
  /** Group heading in the picker. */
  group: string;
  /**
   * Whether this page resolves a real social-card image. Games have screenshots
   * or cover art; the home grid and category pages currently have neither.
   */
  socialImage: string | null;
};

/**
 * The picker's shape, computed once: the vocabulary is a module constant, so
 * grouping it per render (or per keystroke, via `useMemo`) would be work with no
 * input to react to.
 */
const CHANNEL_PICKER = channelsByGroup();

export function LinkBuilder({ destinations }: { destinations: Destination[] }) {
  const [path, setPath] = useState(destinations[0]?.path ?? "/");
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [copied, setCopied] = useState(false);

  const destination = destinations.find((d) => d.path === path) ?? destinations[0];
  const url = useMemo(() => taggedUrl(path, channel), [path, channel]);
  const note = channelNote(channel);

  const groups = useMemo(() => {
    const byGroup = new Map<string, Destination[]>();
    for (const d of destinations) {
      const list = byGroup.get(d.group);
      if (list) list.push(d);
      else byGroup.set(d.group, [d]);
    }
    return [...byGroup.entries()];
  }, [destinations]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const selectClass =
    "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-brand/30";

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">
            Destination
          </span>
          <select
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className={selectClass}
          >
            {groups.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((d) => (
                  <option key={d.path} value={d.path}>
                    {d.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-muted">
            Channel
          </span>
          <select
            value={channel}
            onChange={(e) => setChannel(e.target.value)}
            className={selectClass}
          >
            {CHANNEL_PICKER.map(([group, items]) => (
              <optgroup key={group} label={group}>
                {items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {note && <p className="mt-1 text-xs text-muted">{note}</p>}
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <input
          readOnly
          value={url}
          aria-label="Tagged marketing link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-xs text-zinc-900 outline-none focus:ring-2 focus:ring-brand/30"
        />
        <button
          type="button"
          onClick={() => void copy()}
          className="shrink-0 rounded-full bg-brand px-5 py-2 text-xs font-extrabold text-white transition hover:bg-brand-600"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      {/* What this actually looks like where it gets pasted. */}
      <div className="rounded-xl border border-border bg-surface-2 p-4">
        <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
          Shared-link preview
        </div>

        {destination?.socialImage ? (
          <div className="overflow-hidden rounded-lg border border-border bg-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={destination.socialImage}
              alt=""
              className="aspect-[1.91/1] w-full bg-surface-2 object-cover"
            />
            <div className="p-3">
              <div className="text-sm font-bold text-zinc-900">{destination.label}</div>
              <div className="truncate text-xs text-muted">{url}</div>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-dashed border-amber-300 bg-amber-50">
            <div className="flex aspect-[1.91/1] w-full items-center justify-center px-4 text-center text-xs font-semibold text-amber-900">
              No social image — this link renders as a bare card in chats,
              Discord and search previews.
            </div>
            <div className="border-t border-amber-200 p-3">
              <div className="text-sm font-bold text-amber-900">
                {destination?.label}
              </div>
              <div className="truncate text-xs text-amber-800">{url}</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
