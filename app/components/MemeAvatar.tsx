import { cutoutStyle, type MemeAvatar } from "../lib/avatars";

/**
 * A meme avatar: a circle in the chosen background colour with the meme cutout
 * drawn on top at the meme's fixed framing (see `app/lib/avatars.ts`).
 *
 * Presentational and hook-free, so it renders in server and client components
 * alike. It is `block`, not `inline-block`: an inline-block sits on the text
 * baseline, so any inline parent (a button, a `<span>`) grew a descender gap
 * below it and went taller than wide - an oval selection ring, a lopsided chip.
 * The wrapper clips (`overflow-hidden rounded-full`) because some
 * framings deliberately push the cutout past the circle's edge.
 *
 * `block`, NOT `inline-block`: an inline-block sits on its parent's text
 * baseline, so a wrapper that is not a flex/grid container (the picker's
 * selection ring, the header's `relative` span) grows a descender gap under the
 * circle. The ring then draws as a tall oval and the avatar sits high in its
 * pill. Every caller already places it in a flex row, where `block` is a no-op.
 *
 * Plain `<img>` with an eslint-disable, per the repo convention - a small
 * decorative same-origin thumbnail does not need `next/image`.
 */
export function MemeAvatarCircle({
  meme,
  colour,
  size,
  className = "",
}: {
  meme: MemeAvatar;
  colour: string;
  size: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size, backgroundColor: colour }}
      className={`relative block shrink-0 overflow-hidden rounded-full ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/avatars/${meme.id}.png`}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        draggable={false}
        style={cutoutStyle(meme)}
        className="absolute max-w-none select-none"
      />
    </span>
  );
}
