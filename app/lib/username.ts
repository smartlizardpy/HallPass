/**
 * HallPass — username VALIDATION.
 *
 * A username is the unique, lowercase, ASCII public address at `/u/<username>`.
 * It is a different thing from `players.handle`, which stays a free-form display
 * string, and the difference in CONTRACT is the whole reason this module exists
 * separately from the two existing sanitisers:
 *
 *   `scoreboard/guard.ts` sanitizeHandle  — COERCES, never fails (max 12, falls
 *                                           back to "Guest#4821")
 *   `players.ts`          sanitizeHandle  — COERCES, never fails (max 24,
 *                                           Unicode-hardened, falls back to NULL)
 *   THIS MODULE          validateUsername — VALIDATES, fails with a reason
 *
 * Coercion is actively wrong for a username. It is a claim on a globally unique
 * namespace, so silently turning `Jo$h!!` into `josh` either hands someone a name
 * they did not ask for or mangles their input into a reserved word. The caller
 * needs a reason it can show.
 *
 * Deliberately has NO `import "server-only"`: the format and reserved-word checks
 * are safe to ship to the browser and give instant typeahead feedback. The slur
 * list is the part that must not be shipped — it lives in
 * `username-wordlist.ts`, which IS server-only, so it cannot be scraped to build
 * an offline evasion dictionary.
 *
 * Pure and dependency-free, so it unit-tests in the plain `node` environment like
 * `guard.ts` and `board-input.ts`.
 */

export const USERNAME_MIN_LENGTH = 3;
export const USERNAME_MAX_LENGTH = 20;

export type UsernameRejection =
  | "too-short"
  | "too-long"
  | "charset"
  | "edge-underscore"
  | "double-underscore"
  | "all-digits"
  | "reserved";

export type UsernameValidation =
  | { ok: true; username: string }
  | { ok: false; reason: UsernameRejection };

/**
 * Canonical form: NFKC-normalise, trim, lowercase.
 *
 * NFKC first is belt-and-braces given the ASCII-only charset check that follows
 * would reject them anyway, but it costs one call and folds fullwidth
 * (`ａｄｍｉｎ`), mathematical-alphanumeric (`𝐚𝐝𝐦𝐢𝐧`) and superscript variants down
 * to plain ASCII so they are rejected as RESERVED rather than as bad charset —
 * which is the more accurate error, and stops those forms being treated as
 * distinct available names.
 */
export function normalizeUsername(raw: string): string {
  return raw.normalize("NFKC").trim().toLowerCase();
}

/**
 * Fold visually-confusable characters to a common skeleton.
 *
 * Used ONLY to compare against the reserved list, never as a global uniqueness
 * rule — two unrelated real users can legitimately have names that skeletonise to
 * the same string, and colliding them would be worse than the problem it solves.
 * Against the reserved list it is what stops `4dm1n`, `h4llp4ss` and `m0d`.
 */
export function confusableSkeleton(value: string): string {
  return (
    value
      .replace(/0/g, "o")
      // `1`, `l` and `i` are mutually confusable in most sans-serif faces, so all
      // three collapse to ONE symbol. Mapping `1 -> l` alone (the obvious choice)
      // silently fails the case it exists for: `4dm1n` would skeletonise to
      // `admln`, which does not match `admin`.
      .replace(/[1l]/g, "i")
      .replace(/3/g, "e")
      .replace(/4/g, "a")
      .replace(/5/g, "s")
      .replace(/7/g, "t")
      .replace(/_/g, "")
  );
}

/**
 * Names nobody may claim.
 *
 * Two groups, and both matter:
 *   - every current and plausible-future top-level path segment, so a profile URL
 *     can never shadow a real route;
 *   - impersonation targets, so nobody can present as staff or as the site.
 */
export const RESERVED_USERNAMES: ReadonlySet<string> = new Set([
  // Routes that exist today or plausibly will.
  "admin", "api", "dashboard", "play", "game", "games", "category", "categories",
  "u", "user", "users", "sdk", "auth", "signin", "signout", "login", "logout",
  "account", "settings", "friends", "search", "help", "about", "support",
  "legal", "privacy", "terms", "contact", "sitemap", "robots", "manifest",
  "offline", "sw", "icon", "favicon", "static", "public", "blob", "cdn", "www",
  "mail", "assets", "media", "img", "images", "leaderboard", "leaderboards",
  // Impersonation.
  "hallpass", "hp", "mod", "mods", "moderator", "moderators", "staff", "team",
  "official", "system", "root", "owner", "administrator",
  // Ambiguous / reserved words.
  "me", "you", "null", "undefined", "none", "new", "all", "trending",
  "favorites", "favourites", "anonymous", "guest", "deleted", "player",
]);

/**
 * The reserved list in SKELETON form, built once at module load.
 *
 * The symmetry is the load-bearing part: a skeletonised input can only ever match
 * a skeletonised list. Comparing a folded input against the RAW words silently
 * fails for exactly the inputs the check exists to catch — `4dm1n` folds to
 * `admin` only once `admin` has been folded the same way.
 */
const RESERVED_SKELETONS: ReadonlySet<string> = new Set(
  [...RESERVED_USERNAMES].map(confusableSkeleton),
);

/**
 * Validate a candidate username's SHAPE. Does not check availability (that is a
 * database concern) and does not check the slur list (that is server-only).
 *
 * Rules and why:
 *   3–20 chars   — below 3 the namespace is scarce enough that squatting is
 *                  profitable; 20 fits the chip layout without truncating.
 *   [a-z0-9_]    — ASCII only, so every Unicode case-folding hazard disappears
 *                  and a plain UNIQUE btree is a correct case-insensitive index.
 *   no edge `_`  — a leading or trailing underscore is invisible in most UI.
 *   no `__`      — near-invisible way to mint a lookalike of a taken name.
 *   not all digits — reads like an id and is confusable with a friend code or a
 *                  score.
 */
export function validateUsernameFormat(raw: string): UsernameValidation {
  const username = normalizeUsername(raw);

  // Length is measured in code points, but the charset check below restricts to
  // ASCII anyway, so `.length` and code-point count agree by the time it matters.
  if (username.length < USERNAME_MIN_LENGTH) return { ok: false, reason: "too-short" };
  if (username.length > USERNAME_MAX_LENGTH) return { ok: false, reason: "too-long" };
  if (!/^[a-z0-9_]+$/.test(username)) return { ok: false, reason: "charset" };
  if (username.startsWith("_") || username.endsWith("_")) {
    return { ok: false, reason: "edge-underscore" };
  }
  if (username.includes("__")) return { ok: false, reason: "double-underscore" };
  if (/^[0-9]+$/.test(username)) return { ok: false, reason: "all-digits" };
  if (RESERVED_USERNAMES.has(username)) return { ok: false, reason: "reserved" };
  if (RESERVED_SKELETONS.has(confusableSkeleton(username))) {
    return { ok: false, reason: "reserved" };
  }

  return { ok: true, username };
}

/** Fixed, user-facing copy per rejection. Never reflects the input back. */
export const USERNAME_REJECTION_MESSAGES: Record<UsernameRejection, string> = {
  "too-short": `Usernames need at least ${USERNAME_MIN_LENGTH} characters`,
  "too-long": `Usernames can be at most ${USERNAME_MAX_LENGTH} characters`,
  charset: "Use only letters, numbers and underscores",
  "edge-underscore": "Usernames can't start or end with an underscore",
  "double-underscore": "Usernames can't contain two underscores in a row",
  "all-digits": "Usernames need at least one letter",
  reserved: "That username isn't available",
};

// ---------------------------------------------------------------------------
// Friend codes
// ---------------------------------------------------------------------------

/**
 * The friend-code alphabet: digits plus consonants only.
 *
 * Two constraints shaped it. First, no confusable pairs — `O/0`, `I/1`, `L/1`,
 * `S/5`, `B/8`, `Z/2` each keep exactly ONE member, so a mistyped character has a
 * single unambiguous target and can be folded on input rather than rejected.
 * Second, no accidental words — with `A`, `E` and `U` also excluded, every vowel
 * is gone and English words are essentially unconstructible. That is a structural
 * guarantee rather than a blocklist, which is why it is worth losing the letters.
 *
 * 27 symbols over 8 characters is ~2.8e11 codes.
 */
export const FRIEND_CODE_ALPHABET = "0123456789CDFGHJKMNPQRTVWXY";
export const FRIEND_CODE_LENGTH = 8;

/** Characters a human is likely to type instead of the canonical one. */
const FRIEND_CODE_FOLD: Record<string, string> = {
  O: "0",
  I: "1",
  L: "1",
  S: "5",
  B: "8",
  Z: "2",
};

/**
 * Canonicalise typed input: uppercase, drop the display separators and any `HP`
 * prefix, then fold confusables. Returns "" when nothing valid remains, so the
 * caller can treat empty as "not a code" rather than guessing.
 */
export function normalizeFriendCode(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/^HP/, "");
  let out = "";
  for (const char of cleaned) {
    const folded = FRIEND_CODE_FOLD[char] ?? char;
    if (FRIEND_CODE_ALPHABET.includes(folded)) out += folded;
  }
  return out;
}

export function isValidFriendCode(value: string): boolean {
  return (
    value.length === FRIEND_CODE_LENGTH &&
    [...value].every((c) => FRIEND_CODE_ALPHABET.includes(c))
  );
}

/** Display form: `HP-XXXX-XXXX`. Stored form is always the bare 8 characters. */
export function formatFriendCode(code: string): string {
  return `HP-${code.slice(0, 4)}-${code.slice(4)}`;
}

/**
 * Consonant skeletons that must never appear in a generated code.
 *
 * With every vowel removed from the alphabet, real words cannot form — but
 * consonant clusters still read as slurs to a human, and the code is displayed
 * prominently on the account page. Ten lines to avoid a one-in-a-few-thousand
 * embarrassment is a good trade. Callers regenerate on a hit.
 */
const BLOCKED_CODE_FRAGMENTS = [
  "FCK", "FK", "CNT", "KNT", "NGR", "NGG", "KKK", "DCK", "PRN",
  "FGT", "HTLR", "NZ", "RPE", "SHT", "TWT", "WNK",
];

/** Whether a generated code contains an unfortunate fragment. */
export function isUnfortunateFriendCode(code: string): boolean {
  return BLOCKED_CODE_FRAGMENTS.some((fragment) => code.includes(fragment));
}
