import type { Flair, FlairTone } from "@/app/lib/flair";

/**
 * The row of admin-granted flair pills shown on a full profile.
 *
 * Server component — flair arrives on the {@link FullProfile} the page already
 * has, so there is nothing to fetch and no state to hold, exactly like
 * `BadgeShelf`. It renders nothing at all for an empty list so the header does not
 * grow an empty gap on the overwhelming majority of profiles that have no flair.
 *
 * FLAIR READS LOUDER THAN A BADGE, on purpose. A badge is derived and common; a
 * flair is conferred by a person and rare, so the pills are filled (a solid tone)
 * rather than tinted, to sit a step above the badge shelf in the visual hierarchy.
 */

/**
 * Tone → pill classes. Exported so the dashboard's grant form can preview a pill
 * in the same colours the profile will render, keeping the two from drifting.
 * Solid fills with white text; every pairing clears 4.5:1 contrast.
 */
export const FLAIR_TONE_CLASS: Record<FlairTone, string> = {
  brand: "bg-brand text-white",
  gold: "bg-amber-500 text-white",
  green: "bg-emerald-600 text-white",
  blue: "bg-sky-600 text-white",
  pink: "bg-pink-600 text-white",
  gray: "bg-zinc-700 text-white",
};

/** A single flair pill. Shared by the profile row and the dashboard preview. */
export function FlairPill({ flair }: { flair: Flair }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-black ${
        FLAIR_TONE_CLASS[flair.tone]
      }`}
    >
      {flair.icon && <span aria-hidden>{flair.icon}</span>}
      {flair.label}
    </span>
  );
}

export function FlairRow({ flair }: { flair: Flair[] }) {
  if (flair.length === 0) return null;
  return (
    <ul className="mt-3 flex flex-wrap items-center gap-2">
      {flair.map((item) => (
        <li key={item.id}>
          <FlairPill flair={item} />
        </li>
      ))}
    </ul>
  );
}
