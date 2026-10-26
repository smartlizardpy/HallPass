import "./pack-odds.css";
/* eslint-disable @next/next/no-img-element -- pixel-art prints are drawn at an exact whole-number size; next/image would resample them */
import { packPrintSrc, PACK_PRINT_PX } from "@/app/lib/collectibles/catalogue";
import { packGroups, slotParts, type SlotView } from "@/app/lib/collectibles/pages";

/**
 * "What's in each pack": every pack's current slots and published odds, drawn
 * as prize cards under the Pack Room (pack-odds.css, docs/collectibles-pack-room.md).
 * Static, from the catalogue.
 *
 * The WORDS are the odds disclosure and come from `slotParts` (pages.ts), so a
 * screen reader hears "Slot 1. Always <card> (<rarity>)." / "Slot 2. One card
 * from <pool>: 60% common, ...." exactly as before. The look only dresses those
 * runs: the card name in bold, the rarity as a chip, the percentages as text
 * with a stacked bar under them (`aria-hidden`; it repeats the text). The print
 * is decorative (`alt=""`) because the pack's name is beside it.
 *
 * Packs are grouped by their collection's `kind` (an event, or everyday). A
 * group's label is a `<p>` in a labelled `role="group"`, not a heading, so the
 * outline stays h2 (section) then h3 (one per pack).
 */

function Slot({ slot }: { slot: SlotView }) {
  const parts = slotParts(slot);
  /* A fixed slot's " (rarity)." is kept on one line so a bracket is never left alone at a line end. */
  const nowrapFrom = slot.kind === "fixed" ? parts.findIndex((p) => p.as === "rarity") - 1 : -1;
  const runs = parts.map((p, i) =>
    p.as === "card" ? (
      <strong key={i} className="po-card">
        {p.text}
      </strong>
    ) : p.as === "rarity" && slot.card ? (
      <span key={i} className="po-chip" data-rarity={slot.card.rarity}>
        {p.text}
      </span>
    ) : p.as === "pool" ? (
      <strong key={i} className="po-card">
        {p.text}
      </strong>
    ) : (
      p.text
    ),
  );
  return (
    <li className="po-slot" data-kind={slot.kind}>
      <b className="po-n">Slot {slot.n}.</b>{" "}
      {nowrapFrom > 0 ? (
        <>
          {runs.slice(0, nowrapFrom)}
          <span className="po-nb">{runs.slice(nowrapFrom)}</span>
        </>
      ) : (
        runs
      )}
      {slot.kind === "random" && slot.odds ? (
        <span className="po-bar" aria-hidden="true">
          {slot.odds.map((o) => (
            <span key={o.rarity} data-rarity={o.rarity} style={{ flexBasis: `${o.percent}%` }} />
          ))}
        </span>
      ) : null}
    </li>
  );
}

export function PackContents() {
  return (
    <div className="po-groups">
      {packGroups().map((g) => (
        <div key={g.id} role="group" aria-labelledby={`po-g-${g.id}`} className="po-group">
          <p id={`po-g-${g.id}`} className="po-group-h">
            {g.title}
          </p>
          <div className="po-grid">
            {g.packs.map(({ pack, slots }) => (
              <article key={pack.id} className="po-pack">
                <img className="po-print" src={packPrintSrc(pack.id)} alt="" width={PACK_PRINT_PX.w} height={PACK_PRINT_PX.h} loading="lazy" />
                <div className="po-body">
                  <h3 className="po-name">{pack.name}</h3>
                  <p className="po-desc">{pack.description}</p>
                  <ol className="po-slots">
                    {slots.map((s) => (
                      <Slot key={s.n} slot={s} />
                    ))}
                  </ol>
                </div>
              </article>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
