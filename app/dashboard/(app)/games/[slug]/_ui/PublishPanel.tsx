/**
 * The Publish panel for a STAGED game's control center.
 *
 * A plain server component posting to `publishGameAction`; there is nothing to
 * keep in client state. The panel only renders for a staged game, so a public one
 * never offers a button that has nothing to do.
 *
 * The cover picker lists the game's ACCEPTED beta shots of kind `cover`, plus
 * "keep the current cover" first and selected — publishing without touching the
 * cover is the common case, and a default that changed it would be a surprise on
 * the one action that cannot be quietly undone. "Reset leaderboards" is ticked by
 * default for the reason `publish-actions.ts` gives: scores from a playtest should
 * not become the public board.
 */

import { Section } from "../../../_ui/Section";
import { publishGameAction } from "../publish-actions";

export type CoverChoice = {
  id: string;
  blobUrl: string | null;
};

export function PublishPanel({
  slug,
  title,
  covers,
}: {
  slug: string;
  title: string;
  covers: CoverChoice[];
}) {
  return (
    <Section
      title="Publish"
      subtitle="Staged — only beta testers and the dashboard can see this game"
    >
      <form action={publishGameAction} className="space-y-5">
        <input type="hidden" name="slug" value={slug} />

        <fieldset>
          <legend className="text-sm font-semibold text-foreground">Cover</legend>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2 text-xs font-semibold text-foreground">
              <span className="flex items-center gap-2">
                <input type="radio" name="coverShotId" value="" defaultChecked />
                Keep current cover
              </span>
            </label>
            {covers.map((cover) => (
              <label
                key={cover.id}
                className="flex cursor-pointer flex-col gap-2 rounded-lg border border-border bg-surface-2 p-2 text-xs font-semibold text-foreground"
              >
                {cover.blobUrl && (
                  <span className="relative block aspect-video overflow-hidden rounded bg-zinc-900">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cover.blobUrl}
                      alt="Tester cover shot"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </span>
                )}
                <span className="flex items-center gap-2">
                  <input type="radio" name="coverShotId" value={cover.id} />
                  Use this
                </span>
              </label>
            ))}
          </div>
          {covers.length === 0 && (
            <p className="mt-2 text-xs text-muted">
              No accepted cover shots yet — accept one from the beta programme to
              offer it here.
            </p>
          )}
        </fieldset>

        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            name="resetBoards"
            defaultChecked
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold">Reset leaderboards</span>
            <span className="block text-xs text-muted">
              Clears every score on this game&apos;s boards, so the public board
              starts without playtest scores.
            </span>
          </span>
        </label>

        <button
          type="submit"
          className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
        >
          Publish {title}
        </button>
      </form>
    </Section>
  );
}
