"use client";

/**
 * The card detail dialog: a native `<dialog>` opened with `showModal()`, so the
 * browser moves focus in, keeps the page behind it inert, closes on Esc and
 * returns focus to the card that opened it. It holds the page's ONE `live loop`
 * card; grids never animate.
 *
 * Share sends only `/collectibles/<id>`, the public card page, so a link never
 * says whose card it was.
 */

import { useEffect, useRef, useState } from "react";
import { CollectibleCard } from "./Card";
import { cardPath, freeSlots, type OwnedEntry } from "@/app/lib/collectibles/pages";
import type { Collectible } from "@/app/lib/collectibles/catalogue/types";
import { getCollection } from "@/app/lib/collectibles/catalogue";

export const MAX_FEATURED = 6;

const btn =
  "rounded-full border border-border bg-surface-2 px-4 py-2 text-sm font-bold text-foreground transition hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2";

export function CardDetail({
  card,
  entry,
  isNew,
  binder,
  onClose,
  onPrefs,
}: {
  card: Collectible;
  entry: OwnedEntry;
  isNew: boolean;
  binder: readonly OwnedEntry[];
  onClose: () => void;
  /** Resolves to a sentence for the live region. */
  onPrefs: (change: { favourite?: boolean; featuredPosition?: number | null }) => Promise<string>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  async function change(c: { favourite?: boolean; featuredPosition?: number | null }) {
    setBusy(true);
    setMessage(await onPrefs(c));
    setBusy(false);
  }

  async function share() {
    const url = new URL(cardPath(card.id), window.location.origin).toString();
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: card.name, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage("Link copied.");
    } catch (e) {
      // Closing the share sheet is not an error.
      if (!(e instanceof DOMException && e.name === "AbortError")) setMessage("Could not share. The link is " + url);
    }
  }

  const slots = freeSlots(binder, MAX_FEATURED);
  const date = new Date(entry.firstPulledAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const collection = getCollection(card.collection)?.name ?? card.collection;

  return (
    <dialog
      ref={ref}
      className="hc-dialog"
      aria-labelledby="hc-detail-h"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="p-4 sm:p-5">
        <div className="hc-dialog-card">
          <CollectibleCard card={card} size="lg" live loop copies={entry.owned} isNew={isNew} />
        </div>
        <h2 id="hc-detail-h" className="mt-3 text-xl font-black">
          {card.name}
        </h2>
        {card.caption && <p className="mt-1 text-sm text-foreground-2">{card.caption}</p>}
        <p className="mt-2 text-sm text-muted">
          {collection}. First collected {date}. You have {entry.owned} {entry.owned === 1 ? "copy" : "copies"}.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          <button type="button" className={btn} aria-pressed={entry.favourite} disabled={busy} onClick={() => change({ favourite: !entry.favourite })}>
            {entry.favourite ? "Favourite" : "Mark as favourite"}
          </button>
          <button type="button" className={btn} onClick={share}>
            Share
          </button>
        </div>

        <fieldset className="mt-4">
          <legend className="text-sm font-bold">Feature on my profile</legend>
          <p className="mt-1 text-xs text-muted">Up to {MAX_FEATURED} cards. They show only if your profile is public.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {slots.map(({ slot, heldBy }) => {
              const mine = entry.featuredPosition === slot;
              return (
                <button
                  key={slot}
                  type="button"
                  className={btn}
                  aria-pressed={mine}
                  disabled={busy}
                  aria-label={`Slot ${slot}${mine ? ", this card" : heldBy ? ", taken by another card" : ", free"}`}
                  onClick={() => change({ featuredPosition: slot })}
                >
                  {slot}
                </button>
              );
            })}
            {entry.featuredPosition !== null && (
              <button type="button" className={btn} disabled={busy} onClick={() => change({ featuredPosition: null })}>
                Remove
              </button>
            )}
          </div>
        </fieldset>

        <p className="mt-3 min-h-5 text-sm text-foreground-2" aria-live="polite">
          {message}
        </p>

        <div className="mt-2 flex justify-end">
          <button type="button" className={btn} onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}
