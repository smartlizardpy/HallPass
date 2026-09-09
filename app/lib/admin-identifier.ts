/**
 * HallPass dashboard — what a super admin may type into "Invite admin".
 *
 * The allow-list is keyed by EMAIL and stays that way (see `dashboard-users.ts`:
 * `dashboard_users.email` is the PRIMARY KEY). This module only widens what may
 * be TYPED: an `@username` is resolved to that player's address at invite time
 * and the address is what gets stored.
 *
 * Resolving once, at invite time, rather than storing the username is the whole
 * design. A username is renameable and its old form is released back into the
 * namespace, so a stored username is a key that can quietly come to mean a
 * different person; an address is the stable identity Google actually
 * authenticates. It also means no migration and no second lookup on the request
 * path — `getSessionRole` still reads one indexed column.
 *
 * DISCRIMINATION IS BY "@", and a LEADING "@" always wins. `@alice` is a
 * username, `alice@example.com` is an address, and a bare `alice` is a username —
 * so the two namespaces cannot collide no matter what is pasted in, and nobody
 * has to pick a mode from a dropdown first.
 *
 * Only the SHAPE of a username is checked here, never the policy in
 * `validateUsernameFormat`. That function governs CLAIMING a name — reserved
 * words, confusable skeletons, edge underscores — and applying it to a LOOKUP
 * would be wrong twice over: a name already in `players` was claimable when it
 * was claimed, and if those rules later tighten, an existing player would become
 * un-invitable for a reason that has nothing to do with them.
 *
 * Pure and free of `server-only`, like `username.ts`, so it unit-tests in the
 * plain `node` environment.
 */

import {
  USERNAME_MAX_LENGTH,
  USERNAME_MIN_LENGTH,
  normalizeUsername,
} from "@/app/lib/username";

/** A parsed invite target: an address to store, or a username to resolve first. */
export type AdminIdentifier =
  | { kind: "email"; email: string }
  | { kind: "username"; username: string };

/** A deliberately permissive "looks like an email" shape check. */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The stored username charset — mirrors `validateUsernameFormat`. */
const USERNAME_CHARSET = /^[a-z0-9_]+$/;

/**
 * Parse what was typed into the invite box, or `null` when it is neither a
 * plausible address nor a plausible username.
 *
 * `null` deliberately does not say WHICH it failed as. The caller shows one
 * sentence naming both accepted forms, which is more useful than guessing at
 * intent from a string that matched neither.
 */
export function parseAdminIdentifier(raw: string): AdminIdentifier | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Leading "@" is an explicit "this is a username", so it is honoured before the
  // contains-"@" test below could mistake `@a@b` for an address.
  if (trimmed.startsWith("@")) return asUsername(trimmed.slice(1));
  if (trimmed.includes("@")) {
    const email = trimmed.toLowerCase();
    return EMAIL_SHAPE.test(email) ? { kind: "email", email } : null;
  }
  return asUsername(trimmed);
}

/** Canonicalise and shape-check a username for LOOKUP (not for claiming). */
function asUsername(raw: string): AdminIdentifier | null {
  const username = normalizeUsername(raw);
  if (
    username.length < USERNAME_MIN_LENGTH ||
    username.length > USERNAME_MAX_LENGTH ||
    !USERNAME_CHARSET.test(username)
  ) {
    return null;
  }
  return { kind: "username", username };
}
