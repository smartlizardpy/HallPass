import type { PublicProfile } from "../../lib/social/store";

/**
 * A player's avatar, with an initial-letter fallback.
 *
 * `referrerPolicy="no-referrer"` on the image is not optional: `players.image` is
 * a Google-hosted URL, and without it every avatar render leaks the page the
 * viewer is on to Google. `AccountMenu` already does this; the rule is the same
 * here and matters more, since a friends list renders many at once.
 *
 * Plain `<img>` with an eslint-disable, per the repo convention — `next/image`
 * would need remote-domain config for a small decorative thumbnail.
 */
export function Avatar({
  person,
  size = 40,
}: {
  person: Pick<PublicProfile, "image" | "displayName">;
  size?: number;
}) {
  const dimension = { width: size, height: size };

  if (!person.image) {
    return (
      <span
        aria-hidden
        style={dimension}
        className="grid shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-black text-brand"
      >
        {person.displayName.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={person.image}
      alt=""
      aria-hidden
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      style={dimension}
      className="shrink-0 rounded-full bg-surface-2 object-cover"
    />
  );
}
