/**
 * /collectibles/<id>: the public card page, one per catalogue card. STATIC and
 * `dynamicParams = false`, so an unknown id is a 404. It is the URL the binder
 * shares, so it says nothing about who owns the card: no owner, no counts.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectibleCard } from "@/app/components/collectibles/Card";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";
import { CATALOGUE, getCollectible, getCollection } from "@/app/lib/collectibles/catalogue";
import { cardNumber, RARITY_LABEL } from "@/app/lib/collectibles/present";
import { cardSources, cardPath } from "@/app/lib/collectibles/pages";

export const dynamicParams = false;

export function generateStaticParams() {
  return CATALOGUE.collectibles.map((c) => ({ id: c.id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  const card = getCollectible(id);
  if (!card) return {};
  const collection = getCollection(card.collection)?.name ?? card.collection;
  return {
    title: card.name,
    description: `${card.name}, a ${RARITY_LABEL[card.rarity].toLowerCase()} ${card.kind} from ${collection} on HallPass.${card.caption ? ` ${card.caption}` : ""}`,
    alternates: { canonical: cardPath(card.id) },
  };
}

export default async function CollectiblePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const card = getCollectible(id);
  if (!card) notFound();
  const collection = getCollection(card.collection)?.name ?? card.collection;
  const sources = cardSources(card);

  return (
    <CollectiblesShell>
      <div className="flex flex-col items-center gap-6 sm:flex-row sm:items-start">
        <div className="shrink-0 py-2">
          <CollectibleCard card={card} size="lg" live loop />
        </div>
        <div className="min-w-0">
          <h1 className="text-3xl font-black">{card.name}</h1>
          {card.caption && <p className="mt-2 text-foreground-2">{card.caption}</p>}
          <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="font-bold">Collection</dt>
            <dd>{collection}</dd>
            <dt className="font-bold">Number</dt>
            <dd>{cardNumber(card)}</dd>
            <dt className="font-bold">Rarity</dt>
            <dd>{RARITY_LABEL[card.rarity]}</dd>
          </dl>

          <h2 className="mt-5 text-lg font-black">How to get it</h2>
          {sources.length === 0 ? (
            <p className="mt-1 text-sm text-foreground-2">No pack gives this card right now. Players who already have it keep it.</p>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-foreground-2">
              {sources.map((s) => (
                <li key={s.pack.id}>
                  {s.pack.name}: {s.how === "fixed" ? "this card is always inside." : "it can turn up by chance."}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-sm text-muted">Packs are free and earned. Nothing here can be bought.</p>

          {card.art.status === "demo" && <p className="mt-3 text-sm text-muted">This card uses demo art. Final art comes later.</p>}

          <p className="mt-5 text-sm">
            <Link href="/collection" className="font-bold underline">
              Go to my collection
            </Link>
          </p>
        </div>
      </div>
    </CollectiblesShell>
  );
}
