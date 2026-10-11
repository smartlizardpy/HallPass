import { cutoutStyle, type MemeAvatar } from "../lib/avatars";

/**
 * A meme avatar: a circle in the chosen background colour with the meme cutout
 * drawn on top at the meme's fixed framing (see `app/lib/avatars.ts`).
 *
 * Presentational and hook-free, so it renders in server and client components
 * alike. The wrapper clips (`overflow-hidden rounded-full`) because some
 * framings deliberately push the cutout past the circle's edge.
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
      className={`relative inline-block shrink-0 overflow-hidden rounded-full ${className}`}
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
