/**
 * The Change-cover panel of a game's control center — for staged AND live games.
 *
 * A plain server component. Each candidate is its own one-field form posting to
 * `changeCoverAction`, the same no-JavaScript shape the Media panel uses for its
 * per-image controls (nested forms are invalid HTML, and a single radio form
 * cannot carry both "which kind" and "which id").
 *
 * Candidates, in the order an admin is likely to want them:
 *   1. accepted tester cover shots (from beta testing),
 *   2. previous covers — earlier `hero` rows, so a change can always be undone,
 *   3. gallery screenshots (choosing one moves it out of the gallery, so a cover
 *      never spends one of the eight gallery slots or appears twice),
 *   4. the original cover, for a native game — clears the override.
 * The current cover is shown first and is not offered again.
 */

import { Section } from "../../../_ui/Section";
import { changeCoverAction } from "../cover-actions";

export type CoverShotChoice = {
  id: string;
  blobUrl: string | null;
  promotedMediaId: string | null;
};

export type CoverMediaChoice = {
  id: string;
  url: string;
  width: number;
  height: number;
};

function Candidate({
  slug,
  source,
  id,
  src,
  label,
  note,
}: {
  slug: string;
  source: "shot" | "media";
  id: string;
  src: string | null;
  label: string;
  note?: string;
}) {
  return (
    <li className="rounded-lg border border-border bg-surface-2 p-2">
      {src && (
        <span className="relative block aspect-video overflow-hidden rounded bg-zinc-900">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={label}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover"
          />
        </span>
      )}
      <form action={changeCoverAction} className="mt-2 flex items-center justify-between gap-2">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="source" value={source} />
        <input type="hidden" name="id" value={id} />
        <span className="min-w-0 truncate text-xs text-muted">{note ?? label}</span>
        <button
          type="submit"
          className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-xs font-bold text-foreground-2 hover:bg-surface"
        >
          Use as cover
        </button>
      </form>
    </li>
  );
}

export function CoverPanel({
  slug,
  currentSrc,
  external,
  hasOverride,
  shots,
  previous,
  gallery,
}: {
  slug: string;
  /** The cover as rendered today, or null for a gradient-only external game. */
  currentSrc: string | null;
  external: boolean;
  /** Whether a cover override exists (so "original" would change something). */
  hasOverride: boolean;
  shots: CoverShotChoice[];
  previous: CoverMediaChoice[];
  gallery: CoverMediaChoice[];
}) {
  // Compare by path: the cover pointer may arrive absolute or with a query
  // string, while a media row's URL is always the bare `/game-media/...` path.
  const pathOf = (url: string) => {
    try {
      return new URL(url, "http://x").pathname;
    } catch {
      return url;
    }
  };
  const isCurrent = (url: string) =>
    currentSrc !== null && pathOf(currentSrc) === pathOf(url);
  const shotIsCurrent = (shot: CoverShotChoice) =>
    shot.promotedMediaId !== null &&
    currentSrc !== null &&
    pathOf(currentSrc).startsWith(`/game-media/${slug}/${shot.promotedMediaId}.`);

  const tester = shots.filter((s) => !shotIsCurrent(s));
  const earlier = previous.filter((m) => !isCurrent(m.url));
  const galleryOffer = gallery.filter((m) => !isCurrent(m.url));
  const nothingToOffer =
    tester.length === 0 && earlier.length === 0 && galleryOffer.length === 0;

  return (
    <Section
      title="Cover"
      subtitle="Change the cover from beta-tester shots, earlier covers or the gallery"
    >
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <span className="relative block aspect-video w-48 shrink-0 overflow-hidden rounded bg-zinc-900">
            {currentSrc && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={currentSrc}
                alt="Current cover"
                className="absolute inset-0 h-full w-full object-cover"
              />
            )}
          </span>
          <div className="min-w-0 text-sm text-foreground">
            <p className="font-semibold">Current cover</p>
            <p className="text-xs text-muted">
              The change shows on the arcade and the game page straight away.
              Link-preview (share card) images refresh at the next deploy.
            </p>
          </div>
        </div>

        {tester.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground">Tester cover shots</h3>
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {tester.map((shot) => (
                <Candidate
                  key={shot.id}
                  slug={slug}
                  source="shot"
                  id={shot.id}
                  src={shot.blobUrl}
                  label="Tester cover shot"
                />
              ))}
            </ul>
          </div>
        )}

        {earlier.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground">Previous covers</h3>
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {earlier.map((m) => (
                <Candidate
                  key={m.id}
                  slug={slug}
                  source="media"
                  id={m.id}
                  src={m.url}
                  label="Previous cover"
                  note={`${m.width}×${m.height}`}
                />
              ))}
            </ul>
          </div>
        )}

        {galleryOffer.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold text-foreground">Gallery screenshots</h3>
            <p className="text-xs text-muted">
              Choosing one moves it out of the gallery.
            </p>
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {galleryOffer.map((m) => (
                <Candidate
                  key={m.id}
                  slug={slug}
                  source="media"
                  id={m.id}
                  src={m.url}
                  label="Gallery screenshot"
                  note={`${m.width}×${m.height}`}
                />
              ))}
            </ul>
          </div>
        )}

        {nothingToOffer && (
          <p className="text-xs text-muted">
            No other images to choose from yet — accept a cover shot from the beta
            programme or add screenshots below to offer them here.
          </p>
        )}

        {!external && hasOverride && (
          <form action={changeCoverAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="source" value="original" />
            <button
              type="submit"
              className="rounded-full border border-border bg-surface px-4 py-1.5 text-sm font-bold text-foreground-2 hover:bg-surface-2"
            >
              Restore the original cover
            </button>
          </form>
        )}
      </div>
    </Section>
  );
}
