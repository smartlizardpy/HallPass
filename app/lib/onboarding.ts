/**
 * The onboarding routing decisions, as pure functions.
 *
 * Three questions are asked of a signed-in player, in this order: a display name
 * (handle), a unique @username, and an avatar. WHICH ONE COMES NEXT IS DECIDED BY
 * STATE, never by a wizard counter, so a refresh, a back button or a double
 * submit cannot land on the wrong one.
 *
 *   - handle: mandatory. Without it the Google account name (often a real name)
 *     is what gets published.
 *   - username: skippable. A claim on a unique namespace can fail repeatedly, so
 *     it must never lock anyone out. Not remembered when skipped.
 *   - avatar: skippable. Asked only while `avatar_meme IS NULL`. A skip is
 *     remembered in a 30-day cookie ({@link AVATAR_SKIP_COOKIE}) rather than a
 *     column, so no migration is needed; once it lapses the player is asked once
 *     more, which is acceptable for a cosmetic. Anyone who has chosen never sees
 *     it again.
 *
 * WHY THE GATE EXISTS. `/auth/landing` is the only router that sends a player to
 * `/play/welcome`, but sign-in has several other entry points (`/play/signin`,
 * the dashboard and OAuth consent pages) that used to send Google straight back
 * to the destination page, skipping it entirely. Those now route through
 * `/auth/landing` too, and {@link shouldRedirectToWelcome} backstops everything
 * else (a surviving session cookie, the mid-game popup, a bookmark) with a
 * client-side check on a normal full page load. It is client-side because the
 * public pages must stay statically rendered: a server-side `auth()` in the root
 * layout would make every page dynamic.
 */

export const AVATAR_SKIP_COOKIE = "hp_avatar_skip";
export const AVATAR_SKIP_MAX_AGE_S = 60 * 60 * 24 * 30;

export type OnboardingStep = "handle" | "username" | "avatar" | "done";

export interface OnboardingState {
  handle: string | null | undefined;
  username: string | null | undefined;
  avatarMeme: string | null | undefined;
  avatarSkipped: boolean;
}

/** The next question to ask, or "done". */
export function nextOnboardingStep(s: OnboardingState): OnboardingStep {
  if (!s.handle) return "handle";
  if (!s.username) return "username";
  if (!s.avatarMeme && !s.avatarSkipped) return "avatar";
  return "done";
}

/**
 * `/auth/landing`'s decision: where to send a freshly signed-in player.
 * `destination` is already resolved (role-aware or the caller's `next`).
 */
export function landingTarget(s: OnboardingState, destination: string): string {
  return nextOnboardingStep(s) === "done"
    ? destination
    : `/play/welcome?next=${encodeURIComponent(destination)}`;
}

/** Path prefixes the gate must never fire on: the flow itself, popups, admin. */
const GATE_EXEMPT_PREFIXES = [
  "/play/welcome",
  "/play/auth", // the mid-game sign-in popup keeps its handle-only behaviour
  "/play/signin",
  "/play/signout",
  "/auth",
  "/oauth",
  "/dashboard",
  "/admin",
  "/embed",
  "/offline",
  "/api",
];

export function isGateExempt(pathname: string): boolean {
  return GATE_EXEMPT_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/**
 * The client gate's decision, made on a full page load.
 *
 * A missing HANDLE always redirects (it is the one mandatory step, and the
 * welcome page cannot loop back here because it is exempt). The optional steps
 * (username, avatar) redirect at most once per browser (`alreadyPrompted`), so
 * skipping them is final until the next sign-in rather than a nag on every
 * reload.
 */
export function shouldRedirectToWelcome(input: {
  pathname: string;
  step: OnboardingStep;
  alreadyPrompted: boolean;
}): boolean {
  if (isGateExempt(input.pathname)) return false;
  if (input.step === "done") return false;
  if (input.step === "handle") return true;
  return !input.alreadyPrompted;
}
