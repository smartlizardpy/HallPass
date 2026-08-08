/**
 * One card on the tracker board.
 *
 * A server component. The whole card is a link to the item, with the tags as
 * nested links to the tag filter — so the two things somebody wants from a card
 * (open it, or see everything like it) are both one click, and neither needs
 * JavaScript.
 *
 * WHAT A CARD SHOWS, AND WHY IT IS THIS AND NOT MORE. Title, tags, and when the
 * last progress note was written. The brief is not here — it runs to 20 000
 * characters and `listBoard()` does not even select it. The last-update stamp is
 * the one piece of metadata that earns its place, because the question this
 * board exists to answer is "what is happening with this", and a card that has
 * sat in `building` untouched for three weeks should look different from one
 * that moved yesterday.
 */

import Link from "next/link";
import type { TrackerCard } from "@/app/lib/tracker/store";
import { TagChip } from "./Chips";

/**
 * A coarse, dependency-free relative stamp.
 *
 * Deliberately coarse: "3d ago" is all anybody needs from a card, and rendering
 * it on the server means no hydration mismatch between the server's clock and
 * the viewer's — the failure mode a live-ticking timestamp would introduce for a
 * component that is otherwise entirely static.
 */
function ago(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

export function ItemCard({ card }: { card: TrackerCard }) {
  return (
    <article className="rounded-lg border border-border bg-surface p-3">
      <Link
        href={`/dashboard/tracker/${card.id}`}
        className="block text-sm font-bold text-foreground hover:text-brand"
      >
        {card.title}
      </Link>

      {card.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {card.tags.map((tag) => (
            <TagChip
              key={tag}
              tag={tag}
              href={`/dashboard/tracker?tag=${encodeURIComponent(tag)}`}
            />
          ))}
        </div>
      )}

      <p className="mt-2 text-xs text-muted">
        {card.updateCount > 0 && card.lastUpdateAt ? (
          <>
            {card.updateCount} update{card.updateCount === 1 ? "" : "s"} ·{" "}
            {ago(card.lastUpdateAt)}
          </>
        ) : (
          <>added {ago(card.createdAt)}</>
        )}
      </p>
    </article>
  );
}
