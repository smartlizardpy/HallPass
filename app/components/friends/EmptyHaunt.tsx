/**
 * Seasonal furniture for an empty state. Both pieces are `ha-deco`: hidden for
 * everyone by globals.css and shown only under the Fright Fest skin, so with the
 * skin off the empty state is byte-for-byte what it was.
 *
 * The real copy always comes first and is never replaced; the sprite sits beside
 * it and one quiet seasonal line follows it.
 */

export type HauntKind = "ghost" | "tomb" | "lantern";

/** A ghost, tombstone or lantern in the margin of an empty state. Decorative. */
export function EmptySprite({ kind }: { kind: HauntKind }) {
  return (
    <span
      aria-hidden="true"
      className={`ha-deco ha-spr ha-empty-spr ha-empty-${kind}`}
    />
  );
}

/** The one seasonal line, AFTER the real copy. Real text, so not aria-hidden. */
export function EmptyLine({ children }: { children: React.ReactNode }) {
  return <small className="ha-deco ha-empty-line">{children}</small>;
}
