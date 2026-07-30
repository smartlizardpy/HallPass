/**
 * HallPass dashboard — per-game CONTROL CENTER.
 *
 * Everything about one game in a single, game-centric screen, replacing the old
 * shared-dropdown forms. The `slug` route param is awaited (this Next.js's async
 * params convention) and resolved through the override layer; an unknown slug is
 * a genuine 404.
 *
 * Four panels:
 *   - HERO: cover thumbnail, title, category, and an "Open live" link to the
 *     public game page.
 *   - DETAILS: the descriptive override editor (title/tagline/description/
 *     category/tags), prefilled from the RESOLVED game, posting to
 *     `updateGameAction`; a sibling form resets the override via
 *     `clearGameOverrideAction`. The Featured & New flags moved to the Curation
 *     page, so only a small link to it lives here now.
 *   - SOURCE CODE: upload / paste / zip-bundle upload / reset of the playable
 *     source, reusing the existing blob actions, each carrying this game's slug
 *     in a hidden field. A blob listing reports how many custom files are
 *     currently published.
 *   - LEADERBOARDS: the boards linked to this game (with live score counts +
 *     Manage / Unlink), a "create a board for this game" form, and a "link an
 *     existing standalone board" form.
 *
 * FAIL-SOFT: the board reads share one try/catch keyed on `isUnconfiguredDbError`
 * so an unconfigured/unreachable Neon degrades the leaderboards panel to a notice
 * instead of 500-ing the whole control center; the details + source panels need
 * no database and always render.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/app/lib/auth";
import { isUnconfiguredDbError } from "@/app/lib/db";
import { listGameFiles, readPublishedIndexHtml } from "@/app/lib/game-html-blob";
import { buildEmbedSnippet, buildExampleCalls } from "@/app/lib/integration-prompt";
import { SITE_URL } from "@/app/lib/site";
import { CopyBox } from "./_ui/CopyBox";
import { resolveCategories, resolveGame, resolveTags } from "@/app/lib/games-store";
import { store } from "@/app/lib/scoreboard";
import { getGameMedia, mediaPublicPath } from "@/app/lib/game-media";
import {
  MAX_MEDIA_PER_SLUG,
  MAX_MEDIA_PER_UPLOAD,
} from "@/app/lib/image-meta";
import { CoverImage } from "@/app/components/CoverImage";
import type { BoardConfig } from "@/sdk/src/contract";
import { DashHeader } from "../../_ui/DashHeader";
import { Section } from "../../_ui/Section";
import { TagEditor } from "../../_ui/TagEditor";
import { createBoardAction, linkBoardAction, unlinkBoardAction } from "../../boards/actions";
import {
  clearHtmlAction,
  pasteHtmlAction,
  uploadBundleAction,
  uploadHtmlAction,
} from "../actions";
import { clearGameOverrideAction, setGameTagsAction, updateGameAction } from "./actions";
import {
  deleteMediaAction,
  moveMediaAction,
  setMediaAltAction,
  uploadMediaAction,
} from "./media-actions";
import { AchievementPanel } from "./_ui/AchievementPanel";
import { setGameCreditAction } from "./credit-actions";
import { setGameVideoAction } from "./video-actions";
import { getGameCredit } from "@/app/lib/game-credits";
import { MAX_VIDEO_LABEL, getGameVideo } from "@/app/lib/game-videos";
import { youtubeWatchUrl } from "@/app/lib/youtube";
import { listUsers } from "@/app/lib/dashboard-users";

export const metadata: Metadata = {
  title: "Game",
  robots: { index: false, follow: false },
};

type Params = Promise<{ slug: string }>;
type SearchParams = Promise<{ ok?: string | string[]; error?: string | string[] }>;

function asString(value: string | string[] | undefined): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] : value;
}

/** Count of custom `games/<slug>/*` blobs published (0 = build default). Fails soft. */
async function countCustomFiles(slug: string): Promise<number> {
  try {
    return (await listGameFiles(slug)).length;
  } catch {
    // Not found / no blob access → treat as "using the build default".
    return 0;
  }
}

export default async function GameControlPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  await requireRole("admin");

  const { slug } = await params;
  const game = await resolveGame(slug);
  if (!game) notFound();

  const sp = await searchParams;
  const ok = asString(sp.ok);
  const error = asString(sp.error);

  // `getGameMedia` is already fail-soft (returns [] on any DB failure), so it
  // needs no try/catch and does NOT join the `dbUnconfigured` branch below —
  // an unreachable database simply shows an empty Media panel.
  const [categories, tagList, customFileCount, media, credit, video, admins, currentHtml] = await Promise.all([
    resolveCategories(),
    resolveTags(),
    countCustomFiles(slug),
    getGameMedia(slug),
    getGameCredit(slug),
    getGameVideo(slug),
    // Admins, offered as suggestions for the credit. Fail-soft: a Neon blip should
    // cost the dropdown, not the page.
    listUsers().catch(() => []),
    // The current published source, for the copy-out half of the panel. LAST, so
    // it lines up with `currentHtml` in the destructuring above.
    readPublishedIndexHtml(slug),
  ]);
  const tagSuggestions = tagList.map((t) => t.tag);

  // Board reads share one try/catch: an unconfigured DB degrades this panel to a
  // notice instead of 500-ing the page. notFound()/redirect are never thrown in
  // here so their control signals can't be swallowed.
  let myBoards: BoardConfig[] = [];
  let counts: number[] = [];
  let standalone: BoardConfig[] = [];
  let dbUnconfigured = false;
  try {
    myBoards = await store.listBoardsForGame(slug);
    counts = await Promise.all(myBoards.map((b) => store.countScores(b.slug)));
    const all = await store.listBoards();
    standalone = all.filter((b) => !b.gameSlug);
  } catch (err) {
    if (isUnconfiguredDbError(err)) dbUnconfigured = true;
    else throw err;
  }

  const inputClass =
    "mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30";

  return (
    <div className="space-y-6">
      <Link
        href="/dashboard/games"
        className="inline-block text-sm font-semibold text-brand hover:text-brand-600"
      >
        ← All games
      </Link>
      <DashHeader title={game.title} subtitle={game.tagline} />

      {ok && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {ok}
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900">
          {error}
        </div>
      )}

      {/* HERO */}
      <Section>
        <div className="flex flex-wrap items-center gap-5">
          {/* Was a hardcoded `/games/<slug>/cover.png`, which 404s for external
              games — the ones whose thumbnail is most worth seeing here. */}
          <div className="relative aspect-video w-44 shrink-0 overflow-hidden rounded-lg bg-surface-2">
            <CoverImage game={game} initialClass="text-3xl" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xl font-black tracking-tight">{game.title}</h2>
            <p className="mt-1 text-sm text-muted">{game.category}</p>
            <Link
              href={`/game/${slug}`}
              target="_blank"
              className="mt-3 inline-block rounded-full border border-border bg-white px-4 py-1.5 text-sm font-bold text-zinc-700 hover:bg-surface-2"
            >
              Open live ↗
            </Link>
          </div>
        </div>
      </Section>

      {/* DETAILS */}
      <Section title="Details" subtitle="Overrides the static catalogue">
        <form action={updateGameAction} className="space-y-5">
          <input type="hidden" name="slug" value={slug} />

          <label className="block text-sm font-semibold text-zinc-900">
            Title
            <input
              name="title"
              type="text"
              defaultValue={game.title}
              placeholder="Leave blank to use the default"
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Tagline
            <input
              name="tagline"
              type="text"
              defaultValue={game.tagline}
              placeholder="Leave blank to use the default"
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Description
            <textarea
              name="description"
              rows={4}
              defaultValue={game.description}
              placeholder="Leave blank to use the default"
              className={inputClass}
            />
          </label>

          <label className="block text-sm font-semibold text-zinc-900 sm:max-w-xs">
            Category
            <input
              name="category"
              type="text"
              list="game-categories"
              defaultValue={game.category}
              className={inputClass}
            />
            <datalist id="game-categories">
              {categories.map((category) => (
                <option key={category} value={category} />
              ))}
            </datalist>
          </label>

          <p className="text-xs text-muted">
            Featured &amp; New are managed on the{" "}
            <Link
              href="/dashboard/curation"
              className="font-semibold text-brand hover:text-brand-600"
            >
              Curation
            </Link>{" "}
            page.
          </p>

          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Save details
          </button>
        </form>

        <form action={clearGameOverrideAction} className="mt-4 border-t border-border pt-4">
          <input type="hidden" name="slug" value={slug} />
          <button
            type="submit"
            className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
          >
            Reset to defaults
          </button>
          <span className="ml-3 text-xs text-muted">
            Drops every override and reverts to the build&apos;s values.
          </span>
        </form>
      </Section>

      {/* TAGS */}
      <Section title="Credit" subtitle="Who made this game">
        {/*
          ONE name. This started as two — "created by" and "added by" — on the
          theory that one person writes a game and another does the HallPass
          integration. Everybody here writes their own games, so the two fields
          always wanted the same answer, and a form with two boxes that always
          want the same answer is a form people fill in wrong.

          Free text with the admins offered as suggestions rather than a hard
          select: a game can come from somebody who has no account here, and a
          select would make those games unattributable.
        */}
        <form action={setGameCreditAction} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input
            type="text"
            name="creditName"
            list="hp-admin-names"
            defaultValue={credit?.uploaderName ?? game.author ?? ""}
            maxLength={60}
            placeholder="Nobody credited yet"
            className="w-full max-w-sm rounded-lg border border-border px-3 py-2 text-sm"
          />
          <datalist id="hp-admin-names">
            {admins
              .map((u) => u.name?.trim())
              .filter((n): n is string => Boolean(n))
              .map((n) => (
                <option key={n} value={n} />
              ))}
          </datalist>

          <p className="text-xs text-muted">
            {credit ? (
              <>
                Recorded{" "}
                {new Date(credit.firstUploadedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
                .{" "}
              </>
            ) : (
              <>
                New dashboard uploads fill this in automatically, and re-uploading
                never changes an existing credit.{" "}
              </>
            )}
            Shown on the game page as &ldquo;By &lt;name&gt;&rdquo;. Leave blank to
            remove it.
          </p>

          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Save credit
          </button>
        </form>
      </Section>

      <Section title="Video" subtitle="Gameplay or intro, shown above the screenshots">
        {/*
          ONE field for the link, because the admin should not have to know what a
          video id is. `parseYouTubeId` accepts every form YouTube's own share UI
          produces — watch, youtu.be, shorts, embed, with or without the scheme —
          and only the extracted id is stored.

          The link is prefilled as a watch URL rather than as whatever was pasted:
          the pasted string is deliberately not kept (see `video-actions.ts`), and
          rebuilding it from the id is what makes "what is currently attached"
          verifiable in one click.
        */}
        <form action={setGameVideoAction} className="space-y-3">
          <input type="hidden" name="slug" value={slug} />
          <input
            type="url"
            name="videoUrl"
            defaultValue={video ? youtubeWatchUrl(video.youtubeId) : ""}
            placeholder="https://www.youtube.com/watch?v=…"
            className="w-full max-w-lg rounded-lg border border-border px-3 py-2 text-sm"
          />
          <input
            type="text"
            name="videoLabel"
            defaultValue={video?.label ?? ""}
            maxLength={MAX_VIDEO_LABEL}
            placeholder="Gameplay"
            className="w-full max-w-[12rem] rounded-lg border border-border px-3 py-2 text-sm"
          />

          <p className="text-xs text-muted">
            {video ? (
              <>
                Attached as{" "}
                <a
                  href={youtubeWatchUrl(video.youtubeId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-bold text-brand hover:text-brand-600"
                >
                  {video.youtubeId}
                </a>
                .{" "}
              </>
            ) : null}
            The label names the button on the game page. Nothing loads from YouTube
            until a player presses play — the poster is this game&apos;s first
            screenshot, so the video costs the page nothing. Leave the link blank to
            remove it.
          </p>

          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Save video
          </button>
        </form>
      </Section>

      <Section title="Tags" subtitle="Drives search & discovery">
        <form action={setGameTagsAction} className="space-y-5">
          <input type="hidden" name="slug" value={slug} />
          <TagEditor defaultTags={game.tags} suggestions={tagSuggestions} />
          <button
            type="submit"
            className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
          >
            Save tags
          </button>
        </form>
      </Section>

      {/* MEDIA — sits between Tags and Source code: media is descriptive (like
          details/tags), source is operational. */}
      <Section
        title="Media"
        subtitle={`${media.length} / ${MAX_MEDIA_PER_SLUG} screenshots · shown on the game's store page`}
      >
        <div className="space-y-6">
          {media.length === 0 ? (
            <p className="text-sm text-muted">
              No screenshots yet. The store page falls back to the cover art
              until you add some.
            </p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {media.map((item, index) => (
                <li key={item.id} className="rounded-lg border border-border p-3">
                  <div className="relative aspect-video w-full overflow-hidden rounded bg-surface-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaPublicPath(item)}
                      alt={item.alt || `Screenshot ${index + 1}`}
                      width={item.width}
                      height={item.height}
                      loading="lazy"
                      className="absolute inset-0 h-full w-full object-cover"
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-xs text-muted">
                      #{index + 1} · {item.width}×{item.height} ·{" "}
                      {Math.round(item.bytes / 1024)} KB
                    </p>
                    {/* Two one-field forms rather than a drag handle: this works
                        with no JavaScript, and the server derives the new order
                        from the direction. */}
                    <div className="flex shrink-0 gap-1">
                      <form action={moveMediaAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          disabled={index === 0}
                          aria-label={`Move screenshot ${index + 1} earlier`}
                          className="grid h-7 w-7 place-items-center rounded border border-border text-xs font-bold text-zinc-700 hover:bg-surface-2 disabled:opacity-30"
                        >
                          ↑
                        </button>
                      </form>
                      <form action={moveMediaAction}>
                        <input type="hidden" name="slug" value={slug} />
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          disabled={index === media.length - 1}
                          aria-label={`Move screenshot ${index + 1} later`}
                          className="grid h-7 w-7 place-items-center rounded border border-border text-xs font-bold text-zinc-700 hover:bg-surface-2 disabled:opacity-30"
                        >
                          ↓
                        </button>
                      </form>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}

          {/* Per-image controls live in their own forms so they never nest
              inside the reorder form above — nested <form> is invalid HTML and
              silently breaks submission. */}
          {media.length > 0 && (
            <ul className="space-y-2 border-t border-border pt-6">
              {media.map((item, index) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-3"
                >
                  <form
                    action={setMediaAltAction}
                    className="flex min-w-0 flex-1 items-end gap-2"
                  >
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={item.id} />
                    <label className="block min-w-0 flex-1 text-xs font-semibold text-zinc-900">
                      Description for #{index + 1}{" "}
                      <span className="font-normal text-muted">
                        (screen readers)
                      </span>
                      <input
                        name="alt"
                        type="text"
                        defaultValue={item.alt}
                        placeholder="e.g. Player dodging lasers in the neon tunnel"
                        className={inputClass}
                      />
                    </label>
                    <button
                      type="submit"
                      className="shrink-0 rounded-full border border-border bg-white px-4 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
                    >
                      Save
                    </button>
                  </form>
                  <form action={deleteMediaAction} className="shrink-0">
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="id" value={item.id} />
                    <button
                      type="submit"
                      className="rounded-full border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-900 hover:bg-red-100"
                    >
                      Delete
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          {media.length < MAX_MEDIA_PER_SLUG && (
            <form
              action={uploadMediaAction}
              className="space-y-3 border-t border-border pt-6"
            >
              <input type="hidden" name="slug" value={slug} />
              <label className="block text-sm font-semibold text-zinc-900">
                Add screenshots
                <input
                  name="files"
                  type="file"
                  multiple
                  accept="image/png,image/jpeg,image/webp"
                  className={inputClass}
                />
              </label>
              <p className="text-xs text-zinc-500">
                PNG, JPEG or WebP · up to {MAX_MEDIA_PER_UPLOAD} at a time · max
                4 MB and at least 640px wide each · landscape only. The first
                screenshot becomes the store-page hero and the social preview
                image.
              </p>
              <button
                type="submit"
                className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
              >
                Upload
              </button>
            </form>
          )}
        </div>
      </Section>

      {/* ACHIEVEMENTS — beside Media, and for the same reason: both are page
          data the store page renders, neither touches the playable bundle. The
          panel does its own (fail-soft, uncached) catalogue read. */}
      <Section
        title="Achievements"
        subtitle="Admin-provisioned · a game can only unlock keys defined here"
      >
        <AchievementPanel slug={slug} />
      </Section>

      {/* SOURCE CODE */}
      <Section
        title="Source code"
        subtitle={
          customFileCount > 0
            ? `${customFileCount} custom file${customFileCount === 1 ? "" : "s"} published`
            : "Using the build default"
        }
      >
        <div className="space-y-6">
          {/* COPY OUT — the read half of this panel. An admin copies the current
              code, adds the scoreboard and achievement calls, and publishes it
              back with the forms below. It doubles as the sync point: both admins
              read the same live blob, so whoever opens this page has the latest. */}
          <div className="space-y-3">
            {currentHtml ? (
              <CopyBox
                label="Current published index.html"
                code={currentHtml}
                note="Copy this out, add the snippet below, then publish it back with the forms further down."
              />
            ) : (
              <p className="rounded-xl border border-border bg-surface-2 px-4 py-3 text-xs text-muted">
                This game is on the build default — its source lives in the repo at{" "}
                <code className="font-mono">public/games/{slug}/</code>. Publish an
                HTML file below to start editing it here.
              </p>
            )}

            <CopyBox
              label="Scoreboard + achievements — paste at the end of <body>"
              code={buildEmbedSnippet(slug, SITE_URL)}
              note="The two script tags. Achievement keys must be provisioned in the Achievements panel above first."
            />
            <CopyBox
              label="Example calls — submit a score, unlock, progress, toast"
              code={buildExampleCalls(slug)}
              language="html"
            />
          </div>

          <p className="border-t border-border pt-6 text-xs text-zinc-500">
            Publishing any source below replaces <strong>everything</strong>{" "}
            previously published for this game — a single HTML file counts as a
            one-file bundle.
          </p>
          <form action={uploadHtmlAction} className="space-y-3">
            <input type="hidden" name="slug" value={slug} />
            <label className="block text-sm font-semibold text-zinc-900">
              Upload an <code className="font-mono">.html</code> file
              <input
                name="htmlFile"
                type="file"
                required
                accept=".html,text/html"
                className="mt-2 block w-full text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Upload HTML
            </button>
          </form>

          <form action={pasteHtmlAction} className="space-y-3 border-t border-border pt-6">
            <input type="hidden" name="slug" value={slug} />
            <label className="block text-sm font-semibold text-zinc-900">
              …or paste a full HTML document
              <textarea
                name="html"
                required
                rows={10}
                spellCheck={false}
                placeholder="<!doctype html>…"
                className="mt-2 block w-full rounded-lg border border-border px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Save HTML
            </button>
          </form>

          <form action={uploadBundleAction} className="space-y-3 border-t border-border pt-6">
            <input type="hidden" name="slug" value={slug} />
            <label className="block text-sm font-semibold text-zinc-900">
              …or upload a multi-file bundle (<code className="font-mono">.zip</code> with{" "}
              <code className="font-mono">index.html</code> at its root)
              <input
                name="bundleFile"
                type="file"
                required
                accept=".zip,application/zip"
                className="mt-2 block w-full text-sm"
              />
            </label>
            <button
              type="submit"
              className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
            >
              Upload bundle (.zip)
            </button>
          </form>

          <div className="flex flex-wrap items-center gap-4 border-t border-border pt-6">
            <form action={clearHtmlAction}>
              <input type="hidden" name="slug" value={slug} />
              <button
                type="submit"
                className="rounded-full bg-red-600 px-5 py-2 text-sm font-extrabold text-white hover:bg-red-700"
              >
                Reset to default
              </button>
            </form>
            <Link
              href={`/game/${slug}`}
              target="_blank"
              className="text-sm font-semibold text-brand hover:text-brand-600"
            >
              Open game ↗
            </Link>
          </div>
        </div>
      </Section>

      {/* LEADERBOARDS */}
      <Section title="Leaderboards" subtitle="Boards powering this game">
        {dbUnconfigured ? (
          <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            Database not configured. Set{" "}
            <code className="font-mono">DATABASE_URL</code> to manage leaderboards.
          </div>
        ) : (
          <div className="space-y-6">
            {myBoards.length === 0 ? (
              <p className="text-sm text-muted">
                No leaderboards linked to this game yet.
              </p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {myBoards.map((board, i) => (
                  <li
                    key={board.slug}
                    className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-foreground">
                        {board.title}
                      </div>
                      <div className="text-xs text-muted">
                        <span className="font-mono">{board.slug}</span> ·{" "}
                        {counts[i]} score{counts[i] === 1 ? "" : "s"}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Link
                        href={`/dashboard/boards/${board.slug}`}
                        className="text-sm font-semibold text-brand hover:text-brand-600"
                      >
                        Manage →
                      </Link>
                      <form action={unlinkBoardAction}>
                        <input type="hidden" name="boardId" value={board.slug} />
                        <input type="hidden" name="gameSlug" value={slug} />
                        <button
                          type="submit"
                          className="rounded-full border border-border bg-white px-3 py-1 text-xs font-bold text-zinc-700 hover:bg-surface-2"
                        >
                          Unlink
                        </button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <form
              action={createBoardAction}
              className="space-y-4 border-t border-border pt-6"
            >
              <h3 className="text-sm font-black">Create a leaderboard for this game</h3>
              <input type="hidden" name="gameSlug" value={slug} />
              <input type="hidden" name="returnTo" value={`/dashboard/games/${slug}`} />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <label className="block text-sm font-semibold text-zinc-900">
                  Board id
                  <input
                    name="slug"
                    type="text"
                    required
                    pattern="[a-z0-9][a-z0-9-]*"
                    placeholder="my-game-board"
                    autoComplete="off"
                    className={inputClass}
                  />
                </label>
                <label className="block text-sm font-semibold text-zinc-900">
                  Title
                  <input
                    name="title"
                    type="text"
                    required
                    placeholder="High Scores"
                    className={inputClass}
                  />
                </label>
              </div>
              <label className="block text-sm font-semibold text-zinc-900 sm:max-w-xs">
                Sort
                <select name="sort" defaultValue="desc" className={inputClass}>
                  <option value="desc">Descending (highest first)</option>
                  <option value="asc">Ascending (lowest first)</option>
                </select>
              </label>
              <button
                type="submit"
                className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
              >
                Create leaderboard
              </button>
            </form>

            {standalone.length > 0 && (
              <form
                action={linkBoardAction}
                className="flex flex-wrap items-end gap-3 border-t border-border pt-6"
              >
                <input type="hidden" name="gameSlug" value={slug} />
                <label className="block text-sm font-semibold text-zinc-900">
                  Link an existing standalone board
                  <select name="boardId" defaultValue="" required className={inputClass}>
                    <option value="" disabled>
                      Select a board
                    </option>
                    {standalone.map((board) => (
                      <option key={board.slug} value={board.slug}>
                        {board.title} ({board.slug})
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="rounded-full border border-border bg-white px-5 py-2 text-sm font-bold text-zinc-700 hover:bg-surface-2"
                >
                  Link
                </button>
              </form>
            )}
          </div>
        )}
      </Section>
    </div>
  );
}
