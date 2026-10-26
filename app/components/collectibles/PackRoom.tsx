"use client";

/**
 * The Pack Room's per-player half: sealed packs and recent openings. A client
 * island on the static `/packs` page (see `useMyCollection`). Opening happens
 * at `/packs/open?pack=<publicId>`; this only links there.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { getCollectible, getPack } from "@/app/lib/collectibles/catalogue";
import { CollectibleCard } from "./Card";
import { PackArt } from "./Pack";
import { SignInPrompt } from "./SignInPrompt";
import { useMyCollection } from "./useMyCollection";

/** `sm` on phones, `md` from 640px. Starts `sm` so the first paint is the cheap one. */
function usePackSize(): "sm" | "md" {
  const [size, setSize] = useState<"sm" | "md">("sm");
  useEffect(() => {
    const q = window.matchMedia("(min-width: 640px)");
    const update = () => setSize(q.matches ? "md" : "sm");
    update();
    q.addEventListener("change", update);
    return () => q.removeEventListener("change", update);
  }, []);
  return size;
}

export function PackRoom() {
  const [state] = useMyCollection();
  const size = usePackSize();

  if (state.status === "loading") {
    return <div className="h-40 animate-pulse rounded-2xl bg-surface-2 motion-reduce:animate-none" aria-hidden="true" />;
  }
  if (state.status === "signedOut") {
    return (
      <SignInPrompt>
        <b>Sign in to see your packs.</b> Packs are free and are earned, and they wait for you here.
      </SignInPrompt>
    );
  }
  if (state.status === "unavailable") {
    return <p className="text-sm text-muted">Your packs are not available right now. Try again in a little while.</p>;
  }

  const { sealed, recent } = state.data;
  const dateOf = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");

  return (
    <div className="space-y-8">
      <section aria-labelledby="hc-sealed-h">
        <h2 id="hc-sealed-h" className="text-lg font-black">
          Your sealed packs
        </h2>
        {sealed.length === 0 ? (
          <p className="mt-2 text-sm text-foreground-2">
            You have no sealed packs. Packs are earned, never bought, and for now they come as Fright Fest rewards. Any you earn will wait here, with no deadline.
          </p>
        ) : (
          <ul className="hc-row hc-row-packs mt-3" role="list">
            {sealed.map((p) => {
              const pack = getPack(p.packId);
              if (!pack) return null;
              return (
                <li key={p.publicId}>
                  <Link href={`/packs/open?pack=${p.publicId}`} className="hc-link" aria-label={`Open ${pack.name}`}>
                    <PackArt packId={p.packId} size={size} decorative />
                    <span className="hc-root hc-pack-cta" aria-hidden="true">
                      Open
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="hc-recent-h">
          <h2 id="hc-recent-h" className="text-lg font-black">
            Recent openings
          </h2>
          <ul className="mt-3 space-y-4" role="list">
            {recent.slice(0, 10).map((o) => (
              <li key={o.pack.publicId}>
                <p className="mb-2 text-sm text-muted">
                  {getPack(o.pack.packId)?.name ?? "Pack"}, opened {dateOf(o.pack.openedAt)}
                </p>
                <div className="hc-row">
                  {o.pulls.map((pull) => {
                    const card = getCollectible(pull.collectibleId);
                    return card ? <CollectibleCard key={pull.slot} card={card} size="sm" isNew={pull.wasNew} /> : null;
                  })}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
