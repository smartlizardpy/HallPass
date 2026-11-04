"use client";

/**
 * The Market, a client island on the static `/market` page: the Hall Tokens
 * balance, the shelf of packs, and the player's spare cards to sell back.
 * Odds are the published pack odds (`slotLines`); nothing here rolls anything.
 */

import { useState } from "react";
import Link from "next/link";
import { getCollectible, getPack, currentVersion } from "@/app/lib/collectibles/catalogue";
import { RARITY_LABEL } from "@/app/lib/collectibles/present";
import { slotLines } from "@/app/lib/collectibles/opening";
import { sellBackValue } from "@/app/lib/hall-tokens/config";
import { SignInPrompt } from "@/app/components/collectibles/SignInPrompt";
import { useMyCollection } from "@/app/components/collectibles/useMyCollection";
import { usePlayerEconomy } from "./usePlayerEconomy";

const btn =
  "rounded-full bg-brand px-4 py-1.5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2";

export function Market() {
  const [collection, , reloadCollection] = useMyCollection();
  const { state, buy, sell } = usePlayerEconomy(reloadCollection);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; openId?: string } | null>(null);

  if (state.status === "loading") {
    return <div className="h-48 animate-pulse rounded-2xl bg-surface-2 motion-reduce:animate-none" aria-hidden="true" />;
  }
  if (state.status === "signedOut") {
    return (
      <SignInPrompt>
        <b>Sign in to use the market.</b> Hall Tokens are earned by playing and kept with your account.
      </SignInPrompt>
    );
  }
  if (state.status === "unavailable") {
    return <p className="text-sm text-muted">The market is not available right now. Try again in a little while.</p>;
  }

  const { balance, market, sellBackPct, recent } = state.data;
  const spare =
    collection.status === "ready"
      ? collection.data.binder
          .filter((b) => b.owned > 1 && getCollectible(b.collectibleId))
          .map((b) => ({ ...b, card: getCollectible(b.collectibleId)! }))
      : [];

  async function run(key: string, action: () => Promise<{ ok: boolean; error?: string; packId?: string }>, done: string) {
    setBusy(key);
    setNotice(null);
    const r = await action();
    setBusy(null);
    setNotice(r.ok ? { text: done, openId: r.packId } : { text: r.error ?? "Something went wrong." });
  }

  return (
    <div className="space-y-8">
      <p className="text-2xl font-black" aria-live="polite">
        {balance.toLocaleString("en-US")} <span className="text-sm font-semibold text-muted">Hall Tokens</span>
      </p>
      <p className="-mt-6 text-xs text-muted">Earn 5 per new game you play each day (up to 30), plus a bonus for a daily streak.</p>

      {notice && (
        <p role="status" className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm">
          {notice.text}{" "}
          {notice.openId && (
            <Link href={`/packs/open?pack=${notice.openId}`} className="font-bold underline">
              Open it
            </Link>
          )}
        </p>
      )}

      <section aria-labelledby="mk-shelf">
        <h2 id="mk-shelf" className="text-lg font-black">Packs</h2>
        <ul className="mt-3 grid gap-4 sm:grid-cols-2">
          {market.map(({ packId, price }) => {
            const pack = getPack(packId);
            if (!pack) return null;
            const short = balance < price;
            return (
              <li key={packId} className="rounded-2xl border border-border bg-surface p-4">
                <h3 className="font-black">{pack.name}</h3>
                <p className="mt-1 text-xs text-muted">{pack.description}</p>
                <ul className="mt-2 text-xs text-foreground-2">
                  {slotLines(currentVersion(pack)).map((l) => (
                    <li key={l}>{l}</li>
                  ))}
                </ul>
                <button
                  type="button"
                  className={`${btn} mt-3`}
                  disabled={short || busy !== null}
                  onClick={() => run(packId, () => buy(packId), `Bought ${pack.name}.`)}
                >
                  {short ? `${price} tokens (need ${price - balance} more)` : `Buy for ${price} tokens`}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="mk-sell">
        <h2 id="mk-sell" className="text-lg font-black">Sell spare cards</h2>
        <p className="mt-1 text-xs text-muted">You keep one of every card. A spare sells for {sellBackPct}% of its value.</p>
        {spare.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No spare cards yet. Duplicates from your packs will show up here.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-2xl border border-border bg-surface">
            {spare.map(({ card, owned }) => (
              <li key={card.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="min-w-0 text-sm">
                  <b>{card.name}</b> <span className="text-muted">{RARITY_LABEL[card.rarity]} · {owned} owned</span>
                </span>
                <button
                  type="button"
                  className={btn}
                  disabled={busy !== null}
                  onClick={() => run(card.id, () => sell(card.id), `Sold ${card.name} for ${sellBackValue(card.rarity)} tokens.`)}
                >
                  Sell for {sellBackValue(card.rarity)}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {recent.length > 0 && (
        <section aria-labelledby="mk-recent">
          <h2 id="mk-recent" className="text-lg font-black">Recent</h2>
          <ul className="mt-3 space-y-1 text-sm">
            {recent.slice(0, 10).map((e, i) => (
              <li key={i} className="flex justify-between">
                <span className="text-foreground-2">{e.kind.replace("_", " ")}{e.ref ? ` · ${e.ref}` : ""}</span>
                <b className={e.amount < 0 ? "text-muted" : ""}>{e.amount > 0 ? "+" : ""}{e.amount}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
