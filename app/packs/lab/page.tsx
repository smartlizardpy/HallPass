/**
 * /packs/lab — DEVELOPMENT ONLY. The Pack Room and the opening over a fake API,
 * so the opening can be previewed, screenshotted and tested without a database
 * or a real pack. A production build renders a 404 here (the check below runs
 * at build time, when NODE_ENV is "production"), and it is never linked.
 *
 *   npm run dev  →  http://localhost:3000/packs/lab
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CollectiblesShell } from "@/app/components/collectibles/CollectiblesShell";
import { LabClient } from "./LabClient";

export const metadata: Metadata = { title: "Pack lab", robots: { index: false, follow: false } };

export default function PackLabPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <CollectiblesShell wide>
      <Suspense>
        <LabClient />
      </Suspense>
    </CollectiblesShell>
  );
}
