/**
 * "Spread the Fright" — the panel's decisions, PURE so they are tested without a
 * browser. The component (SpreadTheFright.tsx) only draws what these return.
 */

/** What `GET /api/v1/referrals/me` returns, as far as the panel reads it. */
export interface MeBody {
  signedIn: boolean;
  available: boolean;
  closesAt: string;
  opensAt: string;
  rules: { enabled: boolean; bonus: number; cap: number };
  token?: string;
  pending?: number;
  rewarded?: number;
  candy?: number;
  remaining?: number;
  windowOpen?: boolean;
}

export type CopyResult = "copied" | "manual";

export interface CopyDeps {
  clipboard?: { writeText(text: string): Promise<void> } | null;
  /** The old textarea + execCommand route; true when it worked. */
  legacy?: (text: string) => boolean;
}

/**
 * Put `text` on the clipboard. 'manual' means every automatic route failed and
 * the caller must show the text selected for the player to copy by hand.
 */
export async function copyText(text: string, deps: CopyDeps): Promise<CopyResult> {
  if (deps.clipboard) {
    try {
      await deps.clipboard.writeText(text);
      return "copied";
    } catch {
      /* permission denied, insecure context, unfocused document: try the old way */
    }
  }
  try {
    if (deps.legacy?.(text)) return "copied";
  } catch {
    /* fall through */
  }
  return "manual";
}

export const COPIED = {
  post: "Copied! Paste it into your favourite community.",
  comment: "Copied! Paste it into a conversation.",
  link: "Invite link copied!",
  message: "Invite message copied!",
} as const;
export const MANUAL = "Couldn't copy automatically. The text is selected: press Ctrl+C (or ⌘C) to copy it.";

export type InviteState =
  | { kind: "loading" }
  | { kind: "signed-out" }
  | { kind: "unavailable" }
  | { kind: "paused" }
  | { kind: "closed" }
  | { kind: "ready"; capReached: boolean };

/** What the invite card and modal should offer. The server enforces all of it; this only explains. */
export function inviteState(me: MeBody | null, failed: boolean): InviteState {
  if (failed) return { kind: "unavailable" };
  if (!me) return { kind: "loading" };
  if (!me.signedIn) return { kind: "signed-out" };
  if (!me.available) return { kind: "unavailable" };
  if (!me.rules.enabled) return { kind: "paused" };
  if (me.windowOpen === false) return { kind: "closed" };
  return { kind: "ready", capReached: (me.remaining ?? 0) <= 0 };
}

export interface Seen {
  rewarded: number;
  candy: number;
}

/**
 * The "your friend joined" banner. Shown when more friends are rewarded than the
 * player last saw, and worth the candy they actually earned since (the real
 * configured award, not a hard-coded 10). Null when nothing is new.
 */
export function rewardBanner(me: MeBody, seen: Seen | null): { text: string; seen: Seen } | null {
  const rewarded = me.rewarded ?? 0;
  const candy = me.candy ?? 0;
  const prev = seen ?? { rewarded: 0, candy: 0 };
  if (rewarded <= prev.rewarded) return null;
  const gained = Math.max(0, candy - prev.candy);
  const many = rewarded - prev.rewarded;
  const text =
    many > 1
      ? `${many} friends joined the Fright! +${gained} candy!`
      : `Your friend joined the Fright! +${gained} candy!`;
  return { text, seen: { rewarded, candy } };
}

/** "2 / 4 friends rewarded" */
export function progressLabel(rewarded: number, cap: number): string {
  return `${Math.min(rewarded, cap)} / ${cap} friends rewarded`;
}

/** Whether a URL's search string carries a friend token, and the URL with it removed. */
export function readLandingToken(search: string, param: string): { token: string | null; cleaned: string } {
  const params = new URLSearchParams(search);
  const token = params.get(param);
  params.delete(param);
  const rest = params.toString();
  return { token, cleaned: rest ? `?${rest}` : "" };
}
