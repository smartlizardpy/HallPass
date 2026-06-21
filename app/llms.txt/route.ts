const BASE = "https://hallpass.gg";

// Static text; safe to cache aggressively at the edge.
export const dynamic = "force-static";

const BODY = `# HallPass Arcade SDK

> HallPass is an unblocked-games arcade. This SDK lets any browser game add a global high-score leaderboard in one line. It works embedded in a HallPass iframe (via postMessage) or standalone on any site (via HTTP), auto-detecting the transport. The SDK never throws — a dead leaderboard can never break your game.

## Quickstart

- [Full integration guide for AI agents](${BASE}/llms-full.txt): the complete, copy-paste-ready, single-fetch reference. Read this first.
- [SDK (hallpass.js)](${BASE}/sdk/v1/hallpass.js): drop in with \`<script src="${BASE}/sdk/v1/hallpass.js" data-game="your-slug"></script>\` then call \`HallPass.submitScore(score)\` on game over.

## Reference

- [SDK source](${BASE}/sdk/v1/hallpass.js): \`window.HallPass\` — \`ready()\`, \`submitScore()\`, \`getScores()\`, \`getHandle()\`, \`setHandle()\`, \`on(event, cb)\`.
- [Leaderboard API](${BASE}/api/v1/leaderboard/neon-snake): \`GET\` returns top scores; \`POST {score, handle}\` submits one. Replace the slug with your game.
- [postMessage protocol](${BASE}/llms-full.txt): messages carry \`source:'hallpass'\`. Game→parent: \`score\`, \`getScores\`, \`ready\`. Parent→game: \`scores\`, \`ready\`, \`submitted\`, \`error\`.

## Examples

- [Vanilla canvas example](${BASE}/llms-full.txt): a complete minimal game wiring submit + display.
- [Scoreboard hub](${BASE}/scoreboard): the public page that displays all initialized boards.

## Optional

- [Limits & fair play](${BASE}/llms-full.txt): handle charset \`[A-Za-z0-9 _-]{1,12}\`, score range \`[0, 1e9]\`, best-effort per-IP rate limiting.
- [Board initialization](${BASE}/llms-full.txt): a board must be created once by the site owner via \`POST /api/v1/scoreboard/init\` with the admin password. Ask the creator for it.
- [Versioning](${BASE}/llms-full.txt): the v1 API and SDK are stable; breaking changes ship under \`/v2\`.
`;

export async function GET() {
  return new Response(BODY, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
