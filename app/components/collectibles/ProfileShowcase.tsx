"use client";

/**
 * The featured cards on a public profile: a client island over
 * `GET /api/v1/collection/showcase/<username>`, which answers only for a PUBLIC
 * profile. `/u/[username]` is dynamic already, but the data is the same for
 * everyone and CDN-cacheable, so it stays out of the page's own render.
 *
 * Renders nothing while loading, when nothing is featured, when the profile is
 * not public and when the request fails: an empty heading would promise cards.
 * Each card is decorative inside its link, which carries the name.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCollectible } from "@/app/lib/collectibles/catalogue";
import type { Collectible } from "@/app/lib/collectibles/catalogue/types";
import { cardPath } from "@/app/lib/collectibles/pages";
import { CollectibleCard } from "./Card";

export function ProfileShowcase({ username }: { username: string }) {
  const [cards, setCards] = useState<Collectible[]>([]);

  useEffect(() => {
    let active = true;
    fetch(`/api/v1/collection/showcase/${encodeURIComponent(username)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { featured?: { position: number; collectibleId: string }[] } | null) => {
        if (!active || !data?.featured) return;
        const found = [...data.featured]
          .sort((a, b) => a.position - b.position)
          .slice(0, 6)
          .flatMap((f) => getCollectible(f.collectibleId) ?? []);
        setCards(found);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [username]);

  if (cards.length === 0) return null;

  return (
    <section className="ha-pcard rounded-3xl bg-surface p-5 sm:p-6" aria-labelledby="hc-showcase-h">
      <h2 id="hc-showcase-h" className="text-[11px] font-black uppercase tracking-wider text-muted">
        Featured cards
      </h2>
      <ul className="hc-row mt-4" role="list">
        {cards.map((card) => (
          <li key={card.id}>
            <Link href={cardPath(card.id)} className="hc-link" aria-label={card.name}>
              <CollectibleCard card={card} size="sm" decorative />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
