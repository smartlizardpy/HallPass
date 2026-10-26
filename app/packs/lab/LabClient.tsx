"use client";

/**
 * DEV-ONLY body of `/packs/lab`: installs the fake API (`mock.ts`) before any
 * collectibles component fetches, then shows the Pack Room or one opening.
 */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { getPack } from "@/app/lib/collectibles/catalogue";
import { OpeningFlow } from "@/app/components/collectibles/opening/OpeningFlow";
import { PackRoom } from "@/app/components/collectibles/PackRoom";
import { LabPack } from "./LabPack";
import { installLabApi, LAB_PACKS } from "./mock";

const openHref = (publicId: string) => `/packs/lab?view=open&pack=${publicId}`;
const LINKS = { open: openHref, room: "/packs/lab?view=room" };

export function LabClient() {
  // Install synchronously on first render, before any child effect fetches.
  useState(() => {
    if (typeof window !== "undefined") installLabApi();
    return true;
  });
  const q = useSearchParams();
  const view = q.get("view");
  const pack = q.get("pack") ?? "";

  if (view === "open" && pack) return <OpeningFlow key={pack} id={pack} links={LINKS} />;
  if (view === "room") return <PackRoom openHref={openHref} />;
  if (view === "pack") return <LabPack id={q.get("id") ?? "hpo-standard"} />;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-black">Pack opening lab</h1>
      <p className="text-sm text-foreground-2">
        Development only. A fake signed-in player kept in this tab&apos;s session storage, so reloads keep what you opened. Add <code>reset=1</code> to start over, <code>slow=2500</code> to
        delay the open call, <code>fail=1</code> to make the first open fail, or <code>state=signedout</code>.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        <li>
          <Link className="underline" href="/packs/lab?view=pack&id=hpo-standard">
            The pack on its own
          </Link>
        </li>
        <li>
          <Link className="underline" href="/packs/lab?view=room">
            Pack Room
          </Link>
        </li>
        {LAB_PACKS.map((p) => (
          <li key={p.publicId}>
            <Link className="underline" href={openHref(p.publicId)}>
              Open: {getPack(p.packId)?.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
