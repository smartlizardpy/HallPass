/**
 * HallPass dashboard — the ACHIEVEMENT authoring panel for one game.
 *
 * A server component, and an async one: it does its own catalogue read rather
 * than taking the list as a prop, so adding it to `page.tsx` is a single element
 * and the panel owns its whole story (read, render, and the four forms that
 * write it back). `getAchievementCatalogue` is already fail-soft — a missing
 * table or an unreachable Neon degrades to `[]` — so there is no try/catch here
 * and no `dbUnconfigured` branch to join.
 *
 * THE READ IS UNCACHED, and must stay that way. Every action redirects straight
 * back to this page with a banner; if the catalogue came from an
 * `unstable_cache`/`use cache` read, the admin would land on the pre-edit list
 * with a green "Saved" banner over it and reasonably conclude the dashboard is
 * broken. Read-your-own-writes is the whole reason this reads live.
 *
 * ── LAYOUT RULE THAT IS EASY TO BREAK: NO NESTED FORMS ──────────────────────
 *
 * Each row carries FOUR independent writes (edit, move up, move down, delete),
 * and `<form>` inside `<form>` is invalid HTML that browsers silently repair by
 * dropping the inner one — the button then submits the OUTER form, so "Delete"
 * would save an edit. Every form here is therefore a SIBLING, laid out with
 * flex/grid rather than by nesting. `media-actions.ts`'s panel documents the
 * same constraint; this is that shape.
 *
 * ── THE KEY IS RENDERED READ-ONLY ───────────────────────────────────────────
 *
 * `key` is what a shipped game passes to `HallPass.unlock()`. Renaming it does
 * not migrate anything — it makes every unlock from every already-published
 * build resolve to nothing and answer `unknown-achievement`, which is a silent
 * failure the game cannot see and the player experiences as "that one never
 * works". So the field is `readOnly` here AND absent from the action's `SET`
 * list; the UI copy says why, because a control that refuses input without
 * explaining itself just reads as a bug.
 */

import {
  getAchievementCatalogue,
  type AchievementDef,
} from "@/app/lib/achievements";
import {
  ACHIEVEMENT_KEY_RE,
  MAX_ACHIEVEMENTS_PER_GAME,
} from "@/app/lib/achievements/config";
import {
  createAchievementAction,
  deleteAchievementAction,
  moveAchievementAction,
  updateAchievementAction,
} from "../achievement-actions";

/**
 * The key pattern for the browser's own `pattern=` hint, anchors stripped.
 *
 * HTML anchors the attribute itself (`^(?:…)$`), so leaving `^`/`$` in would
 * nest anchors — harmless today but exactly the sort of thing that stops
 * matching when the pattern gains an alternation. Derived from the shared
 * constant rather than retyped so the hint cannot drift from `isAchievementKey`,
 * which is the real authority.
 */
const KEY_PATTERN = ACHIEVEMENT_KEY_RE.source.replace(/^\^/, "").replace(/\$$/, "");

const inputClass =
  "mt-2 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30";

/** Read-only variant: visibly inert, still selectable so the key can be copied. */
const readOnlyInputClass =
  "mt-2 w-full cursor-not-allowed rounded-lg border border-border bg-surface-2 px-3 py-2 font-mono text-sm text-zinc-600 outline-none";

export async function AchievementPanel({ slug }: { slug: string }) {
  const list = await getAchievementCatalogue(slug);
  const full = list.length >= MAX_ACHIEVEMENTS_PER_GAME;

  return (
    <div className="space-y-6">
      <p className="text-xs text-zinc-500">
        {list.length} / {MAX_ACHIEVEMENTS_PER_GAME} defined. A game earns one by
        calling{" "}
        <code className="font-mono">HallPass.unlock(&quot;key&quot;)</code> — or{" "}
        <code className="font-mono">HallPass.progress(&quot;key&quot;, n)</code>{" "}
        for a counter. A key that isn&apos;t defined here is a harmless no-op, so
        provision it <strong>before</strong> shipping the game build that uses
        it.
      </p>

      {list.length === 0 ? (
        <p className="text-sm text-muted">
          No achievements yet. The store page hides the whole section until this
          game has at least one.
        </p>
      ) : (
        <ul className="space-y-3">
          {list.map((achievement, index) => (
            <AchievementRow
              key={achievement.id}
              slug={slug}
              achievement={achievement}
              index={index}
              total={list.length}
            />
          ))}
        </ul>
      )}

      {full ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This game is at the maximum of {MAX_ACHIEVEMENTS_PER_GAME}{" "}
          achievements. Delete one to add another.
        </p>
      ) : (
        <CreateForm slug={slug} />
      )}
    </div>
  );
}

/** One catalogue row: identity + reorder, then the edit form, then delete. */
function AchievementRow({
  slug,
  achievement,
  index,
  total,
}: {
  slug: string;
  achievement: AchievementDef;
  index: number;
  total: number;
}) {
  const idValue = String(achievement.id);

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span aria-hidden className="text-2xl leading-none">
            {achievement.icon}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-foreground">
              {achievement.name}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              <span className="font-mono">{achievement.key}</span> ·{" "}
              {achievement.points} pt{achievement.points === 1 ? "" : "s"}
              {achievement.target > 1 && (
                <> · target {achievement.target.toLocaleString()}</>
              )}
              {achievement.secret && <> · secret</>}
            </p>
          </div>
        </div>

        {/* Two one-field forms rather than a drag handle: this works with no
            JavaScript, and the server derives the new order from the direction.
            Posting the rendered order back from hidden fields is the bug this
            shape exists to prevent — those fields are always already in order,
            so the reorder is a permanent no-op that looks like it worked. */}
        <div className="flex shrink-0 gap-1">
          <form action={moveAchievementAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="id" value={idValue} />
            <input type="hidden" name="direction" value="up" />
            <button
              type="submit"
              disabled={index === 0}
              aria-label={`Move ${achievement.name} earlier`}
              className="grid h-7 w-7 place-items-center rounded border border-border text-xs font-bold text-zinc-700 hover:bg-surface-2 disabled:opacity-30"
            >
              ↑
            </button>
          </form>
          <form action={moveAchievementAction}>
            <input type="hidden" name="slug" value={slug} />
            <input type="hidden" name="id" value={idValue} />
            <input type="hidden" name="direction" value="down" />
            <button
              type="submit"
              disabled={index === total - 1}
              aria-label={`Move ${achievement.name} later`}
              className="grid h-7 w-7 place-items-center rounded border border-border text-xs font-bold text-zinc-700 hover:bg-surface-2 disabled:opacity-30"
            >
              ↓
            </button>
          </form>
        </div>
      </div>

      <form
        action={updateAchievementAction}
        className="mt-4 border-t border-border pt-4"
      >
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={idValue} />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="block text-sm font-semibold text-zinc-900">
            Key
            <input
              type="text"
              value={achievement.key}
              readOnly
              // `readOnly`, not `disabled`: a disabled field is not submitted,
              // and this one is deliberately submitted and deliberately ignored
              // by the action, so a forged POST that DOES carry a new key still
              // cannot rename anything.
              aria-describedby={`key-note-${achievement.id}`}
              className={readOnlyInputClass}
            />
            <span
              id={`key-note-${achievement.id}`}
              className="mt-1 block text-xs font-normal text-muted"
            >
              Permanent. Games call this string, so renaming it would silently
              break every build already shipped — delete and re-create instead.
            </span>
          </label>

          <label className="block text-sm font-semibold text-zinc-900">
            Name
            <input
              name="name"
              type="text"
              required
              maxLength={60}
              defaultValue={achievement.name}
              className={inputClass}
            />
          </label>
        </div>

        <label className="mt-4 block text-sm font-semibold text-zinc-900">
          Description
          <textarea
            name="description"
            rows={2}
            maxLength={200}
            defaultValue={achievement.description}
            placeholder="What the player has to do"
            className={inputClass}
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <label className="block text-sm font-semibold text-zinc-900">
            Icon
            <input
              name="icon"
              type="text"
              maxLength={8}
              defaultValue={achievement.icon}
              placeholder="🏅"
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-semibold text-zinc-900">
            Points
            <input
              name="points"
              type="number"
              required
              min={0}
              max={1000}
              step={1}
              defaultValue={achievement.points}
              className={inputClass}
            />
          </label>
          <label className="block text-sm font-semibold text-zinc-900">
            Target
            <input
              name="target"
              type="number"
              required
              min={1}
              max={1000000}
              step={1}
              defaultValue={achievement.target}
              className={inputClass}
            />
          </label>
          <label className="flex items-end gap-2 pb-2.5 text-sm font-semibold text-zinc-900">
            <input
              name="secret"
              type="checkbox"
              defaultChecked={achievement.secret}
              className="h-4 w-4 rounded border-border"
            />
            Secret
          </label>
        </div>

        <button
          type="submit"
          className="mt-4 rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
        >
          Save
        </button>
      </form>

      {/* A SIBLING of the edit form, never nested inside it — see the module
          docblock. Nested, this button would submit the edit instead. */}
      <form
        action={deleteAchievementAction}
        className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4"
      >
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="id" value={idValue} />
        <button
          type="submit"
          className="rounded-full border border-red-300 bg-red-50 px-4 py-2 text-sm font-bold text-red-900 hover:bg-red-100"
        >
          Delete
        </button>
        <span className="text-xs text-muted">
          Also removes it from every player who earned it. There is no undo.
        </span>
      </form>
    </li>
  );
}

/** The provisioning form. Only rendered while the game is under the cap. */
function CreateForm({ slug }: { slug: string }) {
  return (
    <form
      action={createAchievementAction}
      className="space-y-4 border-t border-border pt-6"
    >
      <h3 className="text-sm font-black">Add an achievement</h3>
      <input type="hidden" name="slug" value={slug} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold text-zinc-900">
          Key
          <input
            name="key"
            type="text"
            required
            pattern={KEY_PATTERN}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
            placeholder="first-blood"
            className={`${inputClass} font-mono`}
          />
          <span className="mt-1 block text-xs font-normal text-muted">
            Lowercase letters, numbers, <code className="font-mono">-</code> and{" "}
            <code className="font-mono">_</code>. This is what the game passes to{" "}
            <code className="font-mono">unlock()</code>, and it can never be
            changed afterwards — pick it with the game&apos;s source open.
          </span>
        </label>

        <label className="block text-sm font-semibold text-zinc-900">
          Name
          <input
            name="name"
            type="text"
            required
            maxLength={60}
            placeholder="First Blood"
            className={inputClass}
          />
        </label>
      </div>

      <label className="block text-sm font-semibold text-zinc-900">
        Description
        <textarea
          name="description"
          rows={2}
          maxLength={200}
          placeholder="Defeat your first zombie"
          className={inputClass}
        />
      </label>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <label className="block text-sm font-semibold text-zinc-900">
          Icon
          <input
            name="icon"
            type="text"
            maxLength={8}
            defaultValue="🏅"
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-semibold text-zinc-900">
          Points
          <input
            name="points"
            type="number"
            required
            min={0}
            max={1000}
            step={1}
            defaultValue={10}
            className={inputClass}
          />
        </label>
        <label className="block text-sm font-semibold text-zinc-900">
          Target
          <input
            name="target"
            type="number"
            required
            min={1}
            max={1000000}
            step={1}
            defaultValue={1}
            className={inputClass}
          />
          <span className="mt-1 block text-xs font-normal text-muted">
            1 = plain unlock. Higher makes it a counter with a progress bar.
          </span>
        </label>
        <label className="flex items-start gap-2 text-sm font-semibold text-zinc-900 sm:pt-9">
          <input
            name="secret"
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border"
          />
          <span>
            Secret
            <span className="mt-1 block text-xs font-normal text-muted">
              Name and description stay hidden until it is earned.
            </span>
          </span>
        </label>
      </div>

      <button
        type="submit"
        className="rounded-full bg-brand px-5 py-2 text-sm font-extrabold text-white hover:bg-brand-600"
      >
        Add achievement
      </button>
    </form>
  );
}
