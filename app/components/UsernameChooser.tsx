"use client";

import { useState } from "react";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH } from "@/app/lib/username";

/**
 * The `@username` step of sign-up.
 *
 * A SIBLING OF `HandleChooser`, not a variant of it, because the two ask for
 * different kinds of thing. A handle is a display name — coerced, never rejected,
 * duplicates fine. A username is a claim on a globally unique namespace: it can
 * be taken, reserved or malformed, so this form has to survive being wrong and
 * let the player try again.
 *
 * PREFILLED FROM THE NAME THEY JUST CHOSE, so the common case is one tap. An empty
 * box at sign-up is where people bounce.
 *
 * THE FORMAT HINT IS CLIENT-SIDE, THE VERDICT IS NOT. Length and charset are
 * checked here purely so the player sees the problem as they type; the server
 * re-runs the same rules and additionally checks the slur list, which is
 * deliberately never shipped to a browser. Nothing here is trusted.
 *
 * The skip is a real form POST rather than a link so that a crawler or a link
 * prefetcher cannot skip the step on the player's behalf.
 */
export function UsernameChooser({
  action,
  skipAction,
  suggestion,
  error,
  next,
}: {
  action: (formData: FormData) => void | Promise<void>;
  skipAction: (formData: FormData) => void | Promise<void>;
  suggestion: string;
  error: string | null;
  next: string;
}) {
  const [value, setValue] = useState(suggestion);

  const trimmed = value.trim().toLowerCase();
  // Mirrors the server's format rules closely enough to be useful while typing.
  // It is a HINT: the server decides, and says so in `error` when it disagrees.
  const localProblem =
    trimmed.length === 0
      ? null
      : trimmed.length < USERNAME_MIN_LENGTH
        ? `At least ${USERNAME_MIN_LENGTH} characters`
        : trimmed.length > USERNAME_MAX_LENGTH
          ? `At most ${USERNAME_MAX_LENGTH} characters`
          : !/^[a-z0-9_]+$/.test(trimmed)
            ? "Letters, numbers and underscores only"
            : /^_|_$/.test(trimmed)
              ? "Can't start or end with an underscore"
              : /__/.test(trimmed)
                ? "No two underscores in a row"
                : !/[a-z]/.test(trimmed)
                  ? "Needs at least one letter"
                  : null;

  return (
    <>
      <form action={action} className="mt-5 space-y-3 text-left">
        <input type="hidden" name="next" value={next} />

        <label htmlFor="username" className="sr-only">
          Username
        </label>
        <div className="flex items-center gap-2 rounded-full bg-surface-2 px-4 py-3">
          <span aria-hidden className="text-lg font-black text-muted">
            @
          </span>
          <input
            id="username"
            name="username"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={USERNAME_MAX_LENGTH}
            placeholder="yourname"
            className="w-full bg-transparent text-base font-bold text-zinc-900 placeholder:text-muted outline-none"
          />
        </div>

        {/* Server verdict wins the space when there is one — it is the only
            message that reflects a real claim attempt. */}
        {error ? (
          <p className="text-sm font-bold text-red-700">{error}</p>
        ) : localProblem ? (
          <p className="text-sm font-semibold text-muted">{localProblem}</p>
        ) : (
          <p className="text-sm font-semibold text-muted">
            This is how friends find you. You can change it later.
          </p>
        )}

        <button
          type="submit"
          disabled={trimmed.length === 0 || localProblem !== null}
          className="w-full rounded-full bg-brand px-6 py-3 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Claim @{trimmed || "yourname"}
        </button>
      </form>

      {/* Always available. Sign-in must never be a dead end: if every name a
          player tries is taken, they still have to be able to reach the site. */}
      <form action={skipAction} className="mt-3">
        <input type="hidden" name="next" value={next} />
        <button
          type="submit"
          className="text-sm font-bold text-muted underline-offset-2 transition hover:text-zinc-900 hover:underline"
        >
          Skip for now
        </button>
      </form>
    </>
  );
}
