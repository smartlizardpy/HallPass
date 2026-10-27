"use client";

/**
 * The binder, a client island on the static `/collection` page (per-player data
 * can only come from `/api/`; see `useMyCollection`).
 *
 * NEW badges: the ids that are new on arrival are captured once, shown for this
 * whole visit, and only THEN reported to the server as seen (in batches of at
 * most 100, the API's limit), so the badge does not vanish the moment the page
 * paints. The next visit has none.
 *
 * Grids never animate; the detail dialog holds the one animated card.
 */

import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { CATALOGUE, getCollection, RARITIES } from "@/app/lib/collectibles/catalogue";
import type { Rarity } from "@/app/lib/collectibles/catalogue/types";
import { RARITY_LABEL } from "@/app/lib/collectibles/present";
import { batches, binderGroups, formatProgress, newIds, type OwnedEntry } from "@/app/lib/collectibles/pages";
import { CollectibleCard, LockedCard } from "./Card";
import { CardDetail } from "./CardDetail";
import { SignInPrompt } from "./SignInPrompt";
import { useMyCollection, type CollectionState } from "./useMyCollection";
import type { MyCollection } from "@/app/lib/collectibles";

const chip =
  "rounded-full border border-border px-3 py-1.5 text-sm font-bold transition aria-pressed:bg-brand aria-pressed:text-white aria-pressed:border-transparent bg-surface text-foreground hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2";

export function Binder() {
  const [state, setState] = useMyCollection();

  if (state.status === "loading") {
    return <div className="h-48 animate-pulse rounded-2xl bg-surface-2 motion-reduce:animate-none" aria-hidden="true" />;
  }
  if (state.status === "signedOut") {
    return (
      <SignInPrompt>
        <b>Sign in to see your collection.</b> Packs are free and earned by playing, and they stay in your binder on any device you sign in on.
      </SignInPrompt>
    );
  }
  if (state.status === "unavailable") {
    return <p className="text-sm text-muted">Your collection is not available right now. Try again in a little while.</p>;
  }
  // Mounted only once the data is here, so the NEW set is captured exactly once.
  return <BinderView data={state.data} setState={setState} />;
}

function BinderView({ data, setState }: { data: MyCollection; setState: Dispatch<SetStateAction<CollectionState>> }) {
  const [collection, setCollection] = useState<string>("all");
  const [rarity, setRarity] = useState<Rarity | "all">("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [fresh] = useState<ReadonlySet<string>>(() => new Set(newIds(data.binder)));
  const opener = useRef<HTMLElement | null>(null);

  // Tell the server AFTER the cards (and their NEW badges) are on screen.
  useEffect(() => {
    const ids = [...fresh];
    (async () => {
      for (const batch of batches(ids, 100)) {
        try {
          await fetch("/api/v1/collection/prefs", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ seen: batch }),
          });
        } catch {
          return; // Offline: the badges simply show again next time.
        }
      }
    })();
  }, [fresh]);

  const groups = useMemo(() => binderGroups(data.binder, data.progress, { collection, rarity }), [data, collection, rarity]);

  const entryOf = (id: string) => data.binder.find((b) => b.collectibleId === id) ?? null;
  const openEntry = openId ? entryOf(openId) : null;
  const openCard = openId ? CATALOGUE.collectibles.find((c) => c.id === openId) : undefined;

  async function setPrefs(id: string, change: { favourite?: boolean; featuredPosition?: number | null }): Promise<string> {
    try {
      const r = await fetch("/api/v1/collection/prefs", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collectibleId: id, ...change }),
      });
      if (!r.ok) return "That did not save. Try again.";
      const res = (await r.json()) as { favourite: boolean; featuredPosition: number | null };
      setState((s) => {
        if (s.status !== "ready") return s;
        const binder: OwnedEntry[] = s.data.binder.map((b) => {
          if (b.collectibleId === id) return { ...b, favourite: res.favourite, featuredPosition: res.featuredPosition };
          // Featuring in a slot moves out whatever held it.
          return res.featuredPosition !== null && b.featuredPosition === res.featuredPosition ? { ...b, featuredPosition: null } : b;
        });
        return { status: "ready", data: { ...s.data, binder } };
      });
      if (change.favourite !== undefined) return res.favourite ? "Marked as a favourite." : "Removed from favourites.";
      return res.featuredPosition === null ? "Removed from your profile." : `Featured in slot ${res.featuredPosition}.`;
    } catch {
      return "That did not save. Check your connection and try again.";
    }
  }

  const total = data.binder.length;

  return (
    <div className="space-y-6">
      {data.sealed.length > 0 && (
        <p className="rounded-2xl border border-border bg-surface p-4 text-sm">
          You have <b>{data.sealed.length}</b> sealed {data.sealed.length === 1 ? "pack" : "packs"}.{" "}
          <Link href="/packs" className="font-bold underline">
            Go to the Pack Room
          </Link>
        </p>
      )}

      {total === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-4 text-sm text-foreground-2 sm:p-6">
          <p>
            <b>Your binder is empty for now.</b> Packs are free and are earned, never bought. At the moment they are rewards for taking part in Fright Fest.
          </p>
          <p className="mt-2">
            <Link href="/fright-fest" className="font-bold underline">
              See how Fright Fest rewards work
            </Link>
          </p>
        </div>
      ) : null}

      <div className="space-y-3">
        <div role="group" aria-label="Filter by collection" className="flex flex-wrap gap-2">
          <button type="button" className={chip} aria-pressed={collection === "all"} onClick={() => setCollection("all")}>
            All collections
          </button>
          {data.progress.map((p) => (
            <button key={p.collection} type="button" className={chip} aria-pressed={collection === p.collection} onClick={() => setCollection(p.collection)}>
              {getCollection(p.collection)?.name ?? p.collection}
            </button>
          ))}
        </div>
        <div role="group" aria-label="Filter by rarity" className="flex flex-wrap gap-2">
          <button type="button" className={chip} aria-pressed={rarity === "all"} onClick={() => setRarity("all")}>
            Any rarity
          </button>
          {RARITIES.map((r) => (
            <button key={r} type="button" className={chip} aria-pressed={rarity === r} onClick={() => setRarity(r)}>
              {RARITY_LABEL[r]}
            </button>
          ))}
        </div>
      </div>

      {groups.map((g) => (
        <section key={g.collection} aria-labelledby={`hc-col-${g.collection}`}>
          <h2 id={`hc-col-${g.collection}`} className="text-lg font-black">
            {g.name}
          </h2>
          <p className="mb-3 text-sm text-muted">{formatProgress(g.progress)}</p>
          {g.cells.length === 0 ? (
            <p className="text-sm text-muted">No {rarity === "all" ? "" : RARITY_LABEL[rarity].toLowerCase() + " "}cards in this collection.</p>
          ) : (
            <ul className="hc-grid" role="list">
              {g.cells.map(({ card, entry }) => (
                <li key={card.id}>
                  {entry ? (
                    <button
                      type="button"
                      className="hc-cell"
                      aria-label={`Open ${card.name}`}
                      onClick={(e) => {
                        opener.current = e.currentTarget;
                        setOpenId(card.id);
                      }}
                    >
                      <CollectibleCard card={card} size="sm" copies={entry.owned} isNew={fresh.has(card.id)} decorative />
                    </button>
                  ) : (
                    <LockedCard card={card} size="sm" />
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {openCard && openEntry && (
        <CardDetail
          key={openCard.id}
          card={openCard}
          entry={openEntry}
          isNew={fresh.has(openCard.id)}
          binder={data.binder}
          onClose={() => {
            setOpenId(null);
            opener.current?.focus();
          }}
          onPrefs={(c) => setPrefs(openCard.id, c)}
        />
      )}
    </div>
  );
}
