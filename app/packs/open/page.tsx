/**
 * /packs/open?pack=<public id>: opening one pack. STATIC, ONE PAGE FOR EVERY
 * PACK. The id rides in the query string and only the client reads it, so
 * opening a pack never costs a server render, and an unknown id cannot fill a
 * cache. Everything about the pack (whose it is, what is inside) comes from the
 * same-origin collection API once the page is in the browser.
 */
import type { Metadata } from "next";
import { Suspense } from "react";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";
import { OpenFromQuery } from "@/app/components/collectibles/opening/OpenFromQuery";

export const metadata: Metadata = {
  title: "Open a pack",
  description: "Tear open a HallPass pack and see what is inside.",
  robots: { index: false, follow: false },
};

export default function OpenPackPage() {
  return (
    <CollectiblesShell>
      <Suspense fallback={<div className="min-h-[540px] rounded-[20px] bg-surface" aria-hidden="true" />}>
        <OpenFromQuery />
      </Suspense>
    </CollectiblesShell>
  );
}
