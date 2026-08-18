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
 * THE CHANNEL PICKER IS GROUPED because the vocabulary is now sixteen entries
 * rather than eight, and the groups come from `channels.ts` rather than being
 * assembled here — the destination picker beside it already reads that way, and
 * two pickers side by side that sort differently is a worse problem than a long
 * list.
 *
 * THE SHARE BUTTONS TAG THEMSELVES. Each one opens that app's composer with
 * the link already tagged for it (`share-targets.ts`), and pressing one also
 * moves the channel picker to match — so the URL in the box, the preview under
 * it and the message that just opened all describe the same link. The
 * alternative, buttons that share whatever the picker happens to say, would
 * report a WhatsApp share as TikTok traffic every time someone forgot.
 *
 * The native share sheet is the exception and is meant to be: it is the only
 * control here where the PERSON picks the app after pressing, so it can only
 * honestly use the channel already selected. Whether to offer it at all is read
 * through `useSyncExternalStore` with a `false` server snapshot, the same
 * hydration contract the rail's pin preference follows in `Sidebar.tsx`:
 * `navigator.share` exists on a phone and not on the desktop this page is
 * usually open on, so branching on it during render would mismatch.
 *
 * THE QR CODE ENCODES THE LINK IN THE BOX, not a link of its own. It would be
 * easy to make it always say `?ref=qr` and it would be wrong: two controls on
 * one card describing two different links is how somebody prints a thousand
 * flyers carrying a tag they never chose. The caption says to pick the QR or
 * poster channel before printing instead, which keeps one link on screen.
 *
 * Nothing here reports to analytics. These presses are an admin composing a
 * post, not a player sharing a game — counting them would put our own team in
 * the share-loop numbers that `marketing-design.md` §4c calls exact.
 *
 * Clipboard failure is not an error state, for the same reason as `CopyBox`: an
 * insecure context or a denied permission just means the field stays selectable
 * and the fallback is select-all.
 */

import { useMemo, useState, useSyncExternalStore } from "react";
import { CHANNELS, channelsByGroup, taggedUrl } from "@/app/lib/growth/channels";
import { SHARE_TARGETS, shareHref, shareText } from "@/app/lib/growth/share-targets";
import { qrCode, qrSvgDocument } from "@/app/lib/growth/qr";

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
 * `navigator.share` is fixed for the life of the page — a browser does not grow
 * a share sheet mid-session — so the subscription is a no-op and only the
 * snapshots do any work. Module-level so their identities are stable across
 * renders, which is what keeps `useSyncExternalStore` from resubscribing.
 */
const subscribeToNothing = () => () => {};
const hasShareSheet = () => typeof navigator.share === "function";
const noShareSheetOnServer = () => false;

export function LinkBuilder({ destinations }: { destinations: Destination[] }) {
  const [path, setPath] = useState(destinations[0]?.path ?? "/");
  const [channel, setChannel] = useState(CHANNELS[0].id);
  const [copied, setCopied] = useState(false);

  const canShareNatively = useSyncExternalStore(
    subscribeToNothing,
    hasShareSheet,
    noShareSheetOnServer,
  );

  const destination = destinations.find((d) => d.path === path) ?? destinations[0];
  const url = useMemo(() => taggedUrl(path, channel), [path, channel]);
  const note = CHANNELS.find((c) => c.id === channel)?.note;
  const message = shareText(destination?.label ?? "HALLPASS");
  const qr = useMemo(() => qrCode(url), [url]);

  const channelGroups = useMemo(() => channelsByGroup(), []);

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

  /**
   * The share sheet, tagged with whatever the picker says — the person choosing
   * the app is the only one who knows where it is going. A dismissed sheet
   * rejects, and a person changing their mind is not an error to report, so it
   * is swallowed exactly as `ShareChallenge` does.
   */
  const shareNatively = async () => {
    try {
      await navigator.share({ title: destination?.label, text: message, url });
    } catch {
      /* Dismissed, or the sheet refused. */
    }
  };

  /**
   * SVG rather than PNG, because the size this ends up printed at has not been
   * decided yet and any resolution chosen here would be the wrong one. Built at
   * press time rather than held in state: a blob URL for every keystroke of the
   * pickers would leak one per render, and this costs nothing until asked for.
   */
  const downloadQr = () => {
    const blob = new Blob([qrSvgDocument(qr)], { type: "image/svg+xml" });
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = `hallpass-${fileSlug(path)}-${channel}.svg`;
    link.click();
    // Revoking in the same tick can cancel the download that was just started.
    setTimeout(() => URL.revokeObjectURL(href), 0);
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
            {channelGroups.map(([group, items]) => (
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

      {/* One tap into the app, with that app's own ref already on the link. */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wide text-muted">
            Open in
          </span>
          {SHARE_TARGETS.map((target) => {
            const href = shareHref(target, path, message);
            // A `mailto:` hands off to the OS and would leave a blank tab
            // behind; only a web composer wants a tab of its own.
            const opensTab = href.startsWith("http");
            return (
              <a
                key={target.channel}
                href={href}
                target={opensTab ? "_blank" : undefined}
                rel={opensTab ? "noreferrer noopener" : undefined}
                onClick={() => setChannel(target.channel)}
                className="rounded-full border border-border bg-white px-3.5 py-1.5 text-xs font-bold text-zinc-700 transition hover:border-brand hover:text-brand"
              >
                {target.label}
              </a>
            );
          })}
          {canShareNatively && (
            <button
              type="button"
              onClick={() => void shareNatively()}
              className="rounded-full border border-border bg-white px-3.5 py-1.5 text-xs font-bold text-zinc-700 transition hover:border-brand hover:text-brand"
            >
              Share sheet…
              <span className="sr-only"> — tags the link as {channel}</span>
            </button>
          )}
        </div>
        <p className="mt-2 text-xs text-muted">
          Each button tags the link for itself and moves the picker to match.
          Snapchat, Instagram and Discord publish no share link — pick them above
          and copy instead.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto]">
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

        {/* The same link, for the channels nobody clicks: scanned and printed. */}
        <div className="rounded-xl border border-border bg-surface-2 p-4 lg:w-64">
          <div className="mb-3 text-xs font-bold uppercase tracking-wide text-muted">
            Scan or print
          </div>
          <div className="inline-block rounded-lg border border-border bg-white p-2">
            <svg
              viewBox={`0 0 ${qr.size} ${qr.size}`}
              role="img"
              aria-label={`QR code for ${url}`}
              shapeRendering="crispEdges"
              className="block h-40 w-40"
            >
              {/* Explicit white: a code inverted by a dark viewer does not scan. */}
              <rect width={qr.size} height={qr.size} fill="#ffffff" />
              <path d={qr.path} fill="#000000" />
            </svg>
          </div>
          <button
            type="button"
            onClick={downloadQr}
            className="mt-3 block w-full rounded-full border border-border bg-white px-3 py-1.5 text-xs font-bold text-zinc-700 transition hover:border-brand hover:text-brand"
          >
            Download SVG
          </button>
          <p className="mt-2 text-xs text-muted">
            This encodes the exact link above. Pick <strong>QR code</strong> or{" "}
            <strong>Poster / print</strong> before printing, or the scans report as
            whichever channel is selected.
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * A destination path as a filename fragment: `/game/duskfall` → `game-duskfall`,
 * and the home grid — which is only a slash — as `home` rather than nothing.
 */
function fileSlug(path: string): string {
  return path.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "") || "home";
}
