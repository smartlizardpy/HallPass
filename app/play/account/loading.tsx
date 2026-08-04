import { Wordmark } from "@/app/components/Wordmark";

/**
 * Instant fallback for the account tab.
 *
 * `/play/account` is the one dynamic destination in the mobile tab bar — it reads
 * the session and does a few Neon queries — so without this the tap sat on the
 * previous page until the server render finished. A `loading.tsx` lets Next paint
 * this shell immediately (the route counts as an "instant" transition) and stream
 * the real profile in behind it. Mirrors the page's own shell so the swap is a
 * fill-in, not a jump.
 */
export default function Loading() {
  return (
    <main className="min-h-screen bg-background px-6 py-10">
      <div className="mx-auto max-w-2xl space-y-5">
        <div className="text-center">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-3 text-2xl font-black tracking-tight text-zinc-900">
            Your profile
          </h1>
        </div>

        <div className="space-y-5 motion-safe:animate-pulse">
          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 shrink-0 rounded-full bg-surface-2" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-40 rounded bg-surface-2" />
                <div className="h-3 w-24 rounded bg-surface-2" />
              </div>
            </div>
            <div className="mt-6 h-10 w-full rounded-lg bg-surface-2" />
          </div>

          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="h-4 w-32 rounded bg-surface-2" />
            <div className="mt-4 h-16 w-full rounded-lg bg-surface-2" />
          </div>
        </div>
      </div>
    </main>
  );
}
