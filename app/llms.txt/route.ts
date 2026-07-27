/**
 * `/llms.txt` — concise, AI-agent-facing index for the HallPass Scoreboard SDK.
 *
 * Purpose: when an autonomous agent (or a human) lands on this site and wants to
 * wire a leaderboard into an HTML game, this is the short orientation file. It
 * mirrors the emerging `llms.txt` convention: a terse, plain-text map that points
 * to the full guide at `/llms-full.txt`.
 *
 * Load-bearing decisions:
 *  - The base URL is derived from the request (`new URL(req.url).origin`) rather
 *    than hard-coded, so every example resolves correctly on localhost, on a
 *    preview deployment, and on production (hallpass.gg).
 *  - This module imports ONLY the static `games` list — no Neon, no server-only
 *    code — so it stays a cheap, dependency-free text response.
 *  - Route handlers are not cached by default; we set `Cache-Control` explicitly
 *    (5 minutes) on the Response. Reading `req.url` makes this request-time.
 */

import { games } from "@/app/lib/games";

export async function GET(req: Request) {
  const base = new URL(req.url).origin;
  const gameCount = games.length;

  const body = `# HallPass

> Drop-in leaderboard and achievements for HTML games. One script tag. The client never throws and never blocks your game.

HallPass is a hosted scoreboard SDK for browser games. You add one <script> tag
and call HallPass.submitScore(score) when a run ends. The client is defensive:
it never throws and never blocks the game loop. Where the network or storage is
blocked — for example inside an in-chat AI Canvas sandbox preview — it goes
"inert" and every call resolves to a safe no-op, so the game still runs. Hosted
on a real origin, the same SDK lights up "live" and scores start flowing.

## SDK
- Script:  ${base}/sdk/v1/hallpass.js
- Global:  window.HallPass (alias window.HP)
- Mode:    "live" or "inert" — never throws, never blocks

## Integrate in 3 steps
1. Provision a board once (admin): POST ${base}/api/v1/admin/boards with header
   Authorization: Bearer <ADMIN_PASSWORD> (ask the operator for the site admin
   password) and JSON body { slug, title }. Idempotent — re-creating a board
   returns the existing one and never wipes scores.
2. Paste the snippet near </body>, set data-game="<slug>", and load
   ${base}/sdk/v1/hallpass.js. A tiny stub guarantees window.HallPass exists
   immediately, so the game never breaks even if the SDK script is blocked.
3. At game over call HallPass.submitScore(score). Optionally render a board with
   HallPass.getScores({ limit: 10 }).

## Public API
- GET  ${base}/api/v1/leaderboard/<game>?limit=10&period=all|day|week
       -> { game, title, scoreLabel, sort, period, scores: [{ rank, handle, score }] }
- POST ${base}/api/v1/leaderboard/<game> { score, handle? }
       -> { ok, rank, handle, score }
- POST ${base}/api/v1/admin/boards (admin-only) — provisions a board.
- GET  ${base}/api/v1/games/<game>/achievements
       -> { game, achievements: [{ key, name, icon, points, target, secret,
            progress, unlocked, unlockedAt }], earnedPoints, totalPoints }
- POST ${base}/api/v1/games/<game>/achievements { entries: [{ key, progress? }] }
       -> { ok, reason?, results: [{ key, unlocked, alreadyUnlocked, progress,
            target }] }  (same-origin + signed in; progress is ABSOLUTE)
- Client: HallPass.submitScore, getScores, getHandle, setHandle, ready, on/off,
  plus .mode and .version. Every method resolves; none throw.
- Client (achievements, same-origin + signed in): HallPass.unlock(key),
  unlockMany(keys), progress(key, absoluteValue) — safe to call every frame, the
  SDK coalesces and never drops the final value — and getAchievements(). Listen
  with on("achievement", a => showToast(a.name, a.icon)); it fires ONLY when
  something is newly earned, never for one the player already holds.
- Client (sign-in, same-origin only): HallPass.getPlayer() -> the signed-in
  player's public identity ({ id, name, image, handle }) or null; signIn() /
  signOut() open a small same-origin POPUP (the game is never reloaded — call
  from a click handler); setPlayerHandle(handle) renames the verified player.
  Listen with on("auth", ({ player }) => ...) to react when sign-in/out completes
  (player is null when signed out). Guest scores from this page visit auto-attach
  to the account on sign-in.

## Trust model
Submitting and reading scores are public and unauthenticated. The admin password
only PROVISIONS a board; the game ships only the public slug, never the password.

## Full machine-readable guide
${base}/llms-full.txt  (covers provisioning, the verbatim snippet, the HTTP and
client API, the environment matrix, and all ${gameCount} registered game slugs)
`;

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
