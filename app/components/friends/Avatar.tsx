import { memeAvatarFor, parseAvatarRef } from "../../lib/avatars";
import { MemeAvatarCircle } from "../MemeAvatar";

/**
 * A player's avatar. A meme avatar ref (`/avatars/<id>.png?bg=<hex>`, see
 * `app/lib/avatars.ts`) draws the coloured circle with the cutout on top. Where
 * `image` is null the fallback is the default MEME avatar for the player's
 * public id, never blank: `image` is the real Google photo and is
 * only ever present for an accepted friend who opted in (`use_google_photo`),
 * so everything public arrives here without one. The initial-letter circle
 * remains only for a caller that has no public id at all.
 *
 * `referrerPolicy="no-referrer"` on the image is not optional: `players.image` is
 * a Google-hosted URL, and without it every avatar render leaks the page the
 * viewer is on to Google. `AccountMenu` already does this; the rule is the same
 * here and matters more, since a friends list renders many at once. (It is
 * harmless on the same-origin meme images.)
 *
 * Plain `<img>` with an eslint-disable, per the repo convention — `next/image`
 * would need remote-domain config for a small decorative thumbnail.
 */
export function Avatar({
  person,
  size = 40,
}: {
  person: {
    image?: string | null;
    displayName: string;
    /** `public_id` UUID (friends, reviews, boards). */
    id?: string;
    /** The same value under the name the profile shapes use. */
    publicId?: string;
  };
  size?: number;
}) {
  const dimension = { width: size, height: size };
  const publicId = person.id ?? person.publicId;
  const src = person.image || (publicId ? memeAvatarFor(publicId) : null);

  const meme = parseAvatarRef(src);
  if (meme) {
    return <MemeAvatarCircle meme={meme.meme} colour={meme.colour} size={size} />;
  }

  if (!src) {
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
      src={src}
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
