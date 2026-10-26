"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { OpeningFlow } from "./OpeningFlow";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads `?pack=<public id>` and hands it to the opening. A fresh flow per pack. */
export function OpenFromQuery() {
  const id = useSearchParams().get("pack") ?? "";
  if (!UUID_RE.test(id)) {
    return (
      <section className="space-y-3 rounded-2xl bg-surface p-6 text-center">
        <h1 className="text-2xl font-black">Pick a pack to open</h1>
        <p className="text-sm text-foreground-2">This link doesn&apos;t point at a pack. Your sealed packs are in the Pack Room.</p>
        <Link href="/packs" className="inline-block rounded-full bg-accent-yellow px-5 py-2.5 font-extrabold text-zinc-900">
          Pack Room
        </Link>
      </section>
    );
  }
  return <OpeningFlow key={id} id={id} />;
}
