export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-10 animate-pulse">
      <div className="mb-8 flex items-center justify-between gap-4">
        <div className="space-y-3">
          <div className="h-9 w-44 rounded bg-surface-2" />
          <div className="h-4 w-64 rounded bg-surface-2" />
        </div>
        <div className="h-5 w-28 rounded bg-surface-2" />
      </div>

      <section className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-border bg-surface p-5"
          >
            <div className="h-3 w-24 rounded bg-surface-2" />
            <div className="mt-3 h-10 w-20 rounded bg-surface-2" />
          </div>
        ))}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-5 h-4 w-32 rounded bg-surface-2" />
          <div className="flex h-48 items-end gap-2">
            {Array.from({ length: 12 }).map((_, index) => (
              <div
                key={index}
                className="flex-1 rounded-t bg-surface-2"
                style={{ height: `${40 + ((index * 13) % 45)}%` }}
              />
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-5 h-4 w-24 rounded bg-surface-2" />
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="h-4 w-40 rounded bg-surface-2" />
                  <div className="h-4 w-12 rounded bg-surface-2" />
                </div>
                <div className="h-1.5 rounded-full bg-surface-2" />
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
