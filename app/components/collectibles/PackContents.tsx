import { RARITY_LABEL } from "@/app/lib/collectibles/present";
import { packViews } from "@/app/lib/collectibles/pages";

/** "What's in each pack": every pack's current slots and published odds. Static, from the catalogue. */
export function PackContents() {
  return (
    <div className="space-y-4">
      {packViews().map(({ pack, slots }) => (
        <article key={pack.id} className="rounded-2xl border border-border bg-surface p-4">
          <h3 className="font-black">{pack.name}</h3>
          <p className="mt-1 text-sm text-foreground-2">{pack.description}</p>
          <ol className="mt-3 space-y-2 text-sm">
            {slots.map((s) => (
              <li key={s.n}>
                <b>Slot {s.n}.</b>{" "}
                {s.kind === "fixed" && s.card ? (
                  <>
                    Always {s.card.name} ({RARITY_LABEL[s.card.rarity].toLowerCase()}).
                  </>
                ) : (
                  <>
                    One card from {s.poolName}:{" "}
                    {s.odds?.map((o, i) => (
                      <span key={o.rarity}>
                        {i > 0 && ", "}
                        {o.percent}% {o.label.toLowerCase()}
                      </span>
                    ))}
                    .
                  </>
                )}
              </li>
            ))}
          </ol>
        </article>
      ))}
    </div>
  );
}
