/**
 * Game invites — `POST|OPTIONS /api/v1/me/invites`.
 *
 *   POST { game, data, to?: publicId[], link?: true, expiresInMinutes? }
 *     → { ok: true, sent, code?, url? }
 *     → { ok: false, sent: 0, reason }   (see `INVITE_REASONS`)
 *
 * The write behind `HallPass.invite()`. The picker at `/embed/invite` calls it
 * twice over: once with `to` when the player invites friends, once with
 * `link: true` when they press "Share link". `docs/invites-design.md` has the
 * whole design.
 *
 * ── UNDER `/me/` EVEN THOUGH GUESTS MAY CALL IT ────────────────────────────
 * The sender comes from the session cookie and never from the body, like every
 * other `/me/` write. A FRIEND invite needs that session (401 without). A LINK
 * does not: a signed-out player can still bring a friend into a co-op room, and
 * a guest link simply has no "from". Guests are rate-limited by a SALTED hash
 * of their IP, never the address itself.
 *
 * ── ORIGIN FIRST, FOR EVERYBODY ────────────────────────────────────────────
 * `isTrustedOrigin` runs before anything else, signed in or not. The picker's
 * referrer is its own `/embed/invite`; a game frame's is `/games/…` or
 * `/game-html/…`, which is refused. So a game cannot spray invites without the
 * player pressing a button in our UI — the same defence-in-depth argument as
 * `social/request-guard.ts`, with the same honest limits.
 *
 * ── WHAT IS VALIDATED, AND WHAT IS NOT ─────────────────────────────────────
 * The slug must be a catalogue game the CALLER may see (a hidden staged game is
 * `unknown-game`, exactly like a slug that does not exist). `data` must be a
 * JSON object of at most 1 KB; HallPass never looks inside it. Recipients must
 * be public ids — the store then drops, silently, anyone who is not an accepted
 * friend, is blocked either way, was invited to this game in the last ten
 * minutes, or cannot see a staged game. `sent` is the only thing the response
 * says about them, so it cannot be used to discover a block.
 *
 * ── BOTH IN ONE REQUEST ────────────────────────────────────────────────────
 * Allowed, though the picker never does it. Friends go first; if their hourly
 * limit refuses the batch, the whole request is a 429 and no link is made. If
 * friends were invited and only the link is refused, the response is still
 * `ok` with `sent`, and no `code`.
 */

import { notifyPlayer } from "@/app/lib/notifications/deliver";
import { gameInviteCopy } from "@/app/lib/notifications/copy";
import { clientKeyFromHeaders, hashIp } from "@/app/lib/scoreboard/guard";
import {
  NO_STORE,
  credentialedOptions,
  currentPlayerId,
  isTrustedOrigin,
} from "@/app/lib/social/request-guard";
import { trustedSelfOrigin } from "@/app/lib/site";
import {
  invites,
  reportUnexpected,
  resolveInviteGame,
  stagedViewerAdminEmails,
} from "@/app/lib/invites";
import { generateInviteCode, invitePath } from "@/app/lib/invites/code";
import {
  GUEST_LINK_RATE_LIMIT,
  LINK_RATE_LIMIT,
  MAX_BODY_BYTES,
  MAX_RECIPIENTS_PER_REQUEST,
  clampExpiryMinutes,
  type InviteReason,
} from "@/app/lib/invites/config";
import { parseInviteData } from "@/app/lib/invites/data";

/** The same shape the `game_invites.slug` CHECK enforces. */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A public id. Validated here so a bad one is a 400, not a failed `::uuid[]` cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSAL_STATUS: Record<InviteReason, number> = {
  forbidden: 403,
  "bad-request": 400,
  "signed-out": 401,
  "unknown-game": 404,
  "rate-limited": 429,
  unavailable: 503,
};

function refuse(reason: InviteReason): Response {
  return Response.json(
    { ok: false, sent: 0, reason },
    { status: REFUSAL_STATUS[reason], headers: NO_STORE },
  );
}

/**
 * A JSON object body, or `null` (wrong content type, too big, not an object).
 *
 * The content-type check is the CSRF guard `p2p/index.ts` documents: no CORS
 * headers are ever sent, so a cross-site `application/json` POST needs a
 * preflight that fails, and the one "simple" request that could slip through —
 * a form's `text/plain` — is refused here.
 */
async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return null;
  try {
    const text = await req.text();
    if (text.length > MAX_BODY_BYTES) return null;
    const body = JSON.parse(text) as unknown;
    return body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `to` as unique lowercase public ids, or `null` when it is malformed. */
function parseRecipients(value: unknown): string[] | null {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_RECIPIENTS_PER_REQUEST) return null;
  const ids = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !UUID_RE.test(entry)) return null;
    ids.add(entry.toLowerCase());
  }
  return [...ids];
}

export async function POST(req: Request): Promise<Response> {
  if (!isTrustedOrigin(req)) return refuse("forbidden");

  const body = await readJsonBody(req);
  if (!body) return refuse("bad-request");

  const slug = typeof body.game === "string" ? body.game : "";
  if (!SLUG_RE.test(slug)) return refuse("bad-request");

  const payload = parseInviteData(body.data);
  if (!payload) return refuse("bad-request");

  const minutes = clampExpiryMinutes(body.expiresInMinutes);
  if (minutes === null) return refuse("bad-request");
  const ttlSeconds = minutes * 60;

  const recipients = parseRecipients(body.to);
  if (!recipients) return refuse("bad-request");
  if (body.link !== undefined && typeof body.link !== "boolean") return refuse("bad-request");
  const wantsLink = body.link === true;
  if (recipients.length === 0 && !wantsLink) return refuse("bad-request");

  const playerId = await currentPlayerId();
  if (recipients.length > 0 && !playerId) return refuse("signed-out");

  const target = await resolveInviteGame(slug);
  if (!target) return refuse("unknown-game");

  try {
    let sent = 0;

    if (recipients.length > 0 && playerId) {
      const outcome = await invites.createFriendInvites({
        senderId: playerId,
        slug,
        json: payload.json,
        toPublicIds: recipients,
        codes: recipients.map(() => generateInviteCode()),
        ttlSeconds,
        stagedOnly: target.staged,
        adminEmails: target.staged ? stagedViewerAdminEmails() : [],
      });
      if (outcome.rateLimited) return refuse("rate-limited");
      sent = outcome.sent.length;

      // AWAITED, for the reason `me/challenges` gives: on serverless a floating
      // promise is cancelled when the response ends. `notifyPlayer` never
      // rejects and each send is concurrent, so this cannot undo the invite.
      //
      // The title is the game's real title even for a staged game: every
      // recipient here passed the staged-viewer rule in the same statement
      // that wrote their row, so they can see it.
      await Promise.all(
        outcome.sent.map((invite) =>
          notifyPlayer(invite.toId, {
            kind: "game_invite",
            copy: gameInviteCopy({
              from: outcome.fromDisplayName,
              game: target.game.title,
              code: invite.code,
              minutes,
            }),
            // One notification per invite, ever. Each invite has its own code,
            // so a genuine re-invite after the cooldown is a new key.
            dedupeKey: `game_invite:${invite.code}`,
          }),
        ),
      );
    }

    if (!wantsLink) return Response.json({ ok: true, sent }, { headers: NO_STORE });

    const link = await invites.createLink({
      senderId: playerId,
      senderKey: playerId ? null : hashIp(`invite-ip:${clientKeyFromHeaders(req.headers)}`),
      slug,
      json: payload.json,
      code: generateInviteCode(),
      ttlSeconds,
      limit: playerId ? LINK_RATE_LIMIT : GUEST_LINK_RATE_LIMIT,
    });
    if (!link.code) {
      if (sent > 0) return Response.json({ ok: true, sent }, { headers: NO_STORE });
      // A code collision (one in ~1e17) reads as "try again", like a limit.
      return refuse(link.rateLimited ? "rate-limited" : "unavailable");
    }
    const path = invitePath(link.code);
    return Response.json(
      { ok: true, sent, code: link.code, url: `${trustedSelfOrigin(req.url)}${path}` },
      { headers: NO_STORE },
    );
  } catch (error) {
    // The schema behind the deploy is expected and quiet; anything else is a
    // real fault and is logged before it degrades. Either way the caller can
    // only "try again later", so both are `unavailable`, as in `me/challenges`.
    reportUnexpected("POST me/invites", error);
    return refuse("unavailable");
  }
}

export async function OPTIONS(): Promise<Response> {
  return credentialedOptions("POST, OPTIONS");
}
