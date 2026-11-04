/**
 * /market: spend Hall Tokens on packs, sell spare cards back. STATIC; the wallet
 * and duplicates arrive in the `Market` client island over `/api/` (a page that
 * calls `auth()` stops being prerendered).
 */
import type { Metadata } from "next";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";
import { Market } from "@/app/components/market/Market";

export const metadata: Metadata = {
  title: "Market",
  description: "Spend Hall Tokens on packs and sell spare cards back.",
  alternates: { canonical: "/market" },
};

export default function MarketPage() {
  return (
    <CollectiblesShell>
      <header>
        <h1 className="text-3xl font-black">Market</h1>
        <p className="mt-1 text-sm text-foreground-2">Earn Hall Tokens by playing. Spend them on packs, or sell spare cards back.</p>
      </header>
      <Market />
    </CollectiblesShell>
  );
}
