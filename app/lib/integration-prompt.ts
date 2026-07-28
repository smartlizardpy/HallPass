/**
 * Builds the copy-paste prompt a HallPass admin hands to an AI agent (Gemini
 * Canvas, Claude Artifacts, etc.) to wire THIS board's leaderboard into a game.
 *
 * Framing that matters: the prompt is addressed DIRECTLY to the agent that holds
 * the game's HTML artifact open — it is the thing editing the file. So it speaks
 * in the second person ("you built this game; UPDATE the same artifact"), not as
 * if narrating to an external operator. The agent is told to (1) interview the
 * human first, then (2) append the leaderboard into the existing HTML, and (3)
 * understand that a sandboxed Canvas preview runs the SDK "inert" by design.
 *
 * It is intentionally self-contained: a weak agent cannot be relied on to fetch a
 * URL, so the verbatim embed stub and every method call are inlined. The only
 * per-board inputs are the board id (used as `data-game` and in the API path),
 * the title/sort/score label, and the origin to load the SDK from — derived from
 * the live request so it tracks the current domain (vercel preview today, the
 * real domain later) with no code change. Pure string builder; no I/O.
 */

/**
 * The verbatim synchronous loader stub. Installs `window.HallPass` immediately so
 * the game can call it before the real SDK loads, and flips to a safe inert no-op
 * if the SDK never arrives (e.g. a sandboxed preview). Kept as a plain string so
 * the agent pastes it unchanged. Contains no `${...}` — safe inside a template
 * below.
 *
 * KEEP BYTE-IDENTICAL with the other two copies — `sdk/README.md` and
 * `app/llms-full.txt/route.ts`. Every method the SDK exposes needs an entry here
 * AND a matching entry in the 2s inert fallback at the bottom: a method the stub
 * queues but the fallback forgets leaves a promise unresolved forever, which is a
 * hung game with no error message anywhere. (Games already shipped carry whatever
 * stub they were pasted with — hence the "call it after ready()" note in the
 * docs, rather than any attempt to update them in place.)
 */
const EMBED_STUB = `<script>
(function(w){if(w.HallPass&&w.HallPass.version!=="0")return;var q=[];
function e(n){return function(){var a=[].slice.call(arguments);
return new Promise(function(r){q.push({n:n,a:a,r:r})})}}
w.HallPass=w.HP={version:"0",mode:"loading",_q:q,ready:e("ready"),
submitScore:e("submitScore"),getScores:e("getScores"),
getPlayer:e("getPlayer"),setPlayerHandle:e("setPlayerHandle"),
unlock:e("unlock"),unlockMany:e("unlockMany"),progress:e("progress"),
getAchievements:e("getAchievements"),signIn:function(){},signOut:function(){},
getHandle:function(){return null},setHandle:function(v){return v},
on:function(){q.push({n:"on",a:[].slice.call(arguments),r:function(){}});return this},
off:function(){q.push({n:"off",a:[].slice.call(arguments),r:function(){}});return this}};
setTimeout(function(){if(w.HallPass.version!=="0")return;w.HallPass.mode="inert";
q.splice(0).forEach(function(c){c.r(c.n==="getScores"||c.n==="getAchievements"||c.n==="unlockMany"?[]:c.n==="getPlayer"||c.n==="setPlayerHandle"?null:{ok:false,reason:"inert"})})},2000)})(window);
</script>`;

/**
 * The two `<script>` tags a game needs, ready to paste at the end of its
 * `<body>`: the inline stub (so calls made before the bundle loads are queued,
 * never lost) and the SDK itself, tagged with this game's slug.
 *
 * Exported so the dashboard's source-code panel shows the SAME snippet
 * `buildIntegrationPrompt` embeds — the stub lives in exactly one place and
 * cannot drift between the two surfaces.
 */
export function buildEmbedSnippet(slug: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${EMBED_STUB}
<script src="${base}/sdk/v1/hallpass.js" data-game="${slug}" defer></script>`;
}

/**
 * A worked example of the calls a game makes AFTER the snippet is in place:
 * submit a score, unlock an achievement, report progress, and show a toast. The
 * achievement keys must already be provisioned for this game in the dashboard —
 * an unprovisioned key is a no-op, exactly like an unprovisioned board.
 */
export function buildExampleCalls(slug: string): string {
  return `<script>
  // Do all of this AFTER ready() resolves, so the real SDK has loaded.
  HallPass.ready().then(function () {

    // --- Scoreboard -------------------------------------------------------
    // Call when a run ends. The signed-in player's name is attached for them.
    // HallPass.submitScore(finalScore);

    // --- Achievements (provision the keys in the dashboard first) ----------
    // A one-off unlock:
    // HallPass.unlock("first-blood");

    // A progress achievement — report the ABSOLUTE value, not a delta:
    // HallPass.progress("zombies-killed", killCount);

    // Toast when something is newly earned:
    HallPass.on("achievement", function (a) {
      console.log("Earned:", a.name, a.icon);
    });
  });
</script>
<!-- game: ${slug} -->`;
}

export interface IntegrationPromptInput {
  /** The board id — used verbatim as `data-game` and in `/api/v1/leaderboard/<id>`. */
  slug: string;
  /** Human title of the leaderboard. */
  title: string;
  /** `desc` (high wins, default) or `asc` (low wins — time/golf). */
  sort: "desc" | "asc";
  /** Label shown next to the number, e.g. "Score", "Time". */
  scoreLabel: string;
  /** Origin to load the SDK from and submit to, e.g. `https://hallpass.gg`. No trailing slash. */
  baseUrl: string;
}

/**
 * Produce the full, self-contained agent prompt for one board. The returned
 * string is meant to be copied as-is into an AI agent's chat.
 */
export function buildIntegrationPrompt(input: IntegrationPromptInput): string {
  const { slug, title, scoreLabel } = input;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const sortMeaning =
    input.sort === "asc"
      ? "lower score wins (e.g. time or golf)"
      : "higher score wins";

  const embedScript = `${EMBED_STUB}
<script src="${baseUrl}/sdk/v1/hallpass.js" data-game="${slug}" defer></script>`;

  return `You built a browser game in this Canvas. Now UPDATE that same HTML artifact to add an online leaderboard using HallPass — a hosted scoreboard that needs one script tag and a few function calls. Keep everything you already made; only ADD the leaderboard. Do NOT create a new file, and do NOT redesign or rewrite the game.

This game's leaderboard already exists on HallPass. Use these exact values:
- data-game (board id): ${slug}
- Leaderboard title: ${title}
- Sort: ${input.sort} (${sortMeaning})
- Score label: ${scoreLabel}
- HallPass URL: ${baseUrl}

STEP 1 — Ask me first, then wait.
Before you change any code, ask me these three questions in your next message and STOP for my answers:
1. Where does a round END in your game? (the function or lines where it is "game over" / you show the final score)
2. Which variable holds the player's final score at that moment?
3. Where should the leaderboard list and a "Sign in" button appear — on the start screen, the game-over screen, or a corner of the screen?
Do not guess and do not write any code yet. If I have not answered, ask again.

STEP 2 — After I answer, edit the artifact's HTML:

(a) Load HallPass. Add these two <script> tags once, right before </body>, exactly as written. Leave the first <script> unchanged — it is a tiny loader that makes HallPass safe to call even before it finishes loading:

${embedScript}

(b) Submit the score when a round ends. At the exact spot I described in answers 1 and 2, add:

  HallPass.submitScore(THE_SCORE_VARIABLE_I_TOLD_YOU);

Anonymous players are automatically given a name like "Guest#1234" — no prompt ever appears — while signed-in players post under their verified Google name. It never throws and never blocks the game.

(c) Show the leaderboard and a Sign-in button where I asked in answer 3. A Guest can press Sign in to claim a verified identity — their Google name plus a verified badge — instead of staying an anonymous Guest.

Leaderboard (top 10) — call this when that screen becomes visible:

  HallPass.getScores({ limit: 10 }).then(function (rows) {
    // rows is an array of { rank, handle, score, verified, avatar }
    // render each row as:  #<rank>  <handle>  -  <score>
    // if rows is empty, show: "Be the first to score!"
  });

Sign in (so scores attach to a real Google account instead of an anonymous Guest):

  HallPass.getPlayer().then(function (player) {
    // player is null when signed out; otherwise { name, image, handle }
    // signed in  -> show "Signed in as " + player.name
    // signed out -> show a "Sign in" button wired to the call below
  });
  // the "Sign in" button's click handler (must be a real click — it opens a popup):
  HallPass.signIn();

HallPass.signIn() opens a small sign-in popup; the game keeps running and is NEVER
reloaded, so any score already in progress is safe. Wire it to a real click (a
button's onclick) — browsers block popups opened without a user gesture. Any guest
scores submitted during this visit are attached to the account automatically once
sign-in completes.

Because the game is not reloaded, listen for the "auth" event to live-update the
label the moment sign-in (or sign-out) finishes in the popup:

  HallPass.on("auth", function (e) {
    // e.player is null when signed out, otherwise { name, image, handle }
    // signed in  -> show "Signed in as " + e.player.name
    // signed out -> show the "Sign in" button again
  });

(d) OPTIONAL — achievements. If (and only if) I tell you this game has
achievements, I will give you their exact keys. Do NOT invent keys: they are
provisioned by an admin, and an unknown key does nothing. With real keys, the
whole integration is a toast listener plus one call where the thing is earned:

  HallPass.on("achievement", function (a) {
    // fires ONLY when something is newly earned — never for one already held
    // a = { key, name, description, icon, points, progress, target, game }
    showToast(a.name, a.icon);   // or whatever your game uses for a banner
  });

  HallPass.unlock("THE_KEY_I_GAVE_YOU");          // earn one outright
  HallPass.progress("THE_KEY_I_GAVE_YOU", n);     // a counter: n is the ABSOLUTE
                                                  // total so far, never "+1"

progress() is safe to call every frame — the SDK batches it — and achievements
only apply to signed-in players on this site, so calls quietly resolve
{ ok:false, reason:"signed-out" } elsewhere. Nothing throws.

STEP 3 — Read this so you don't think it is broken:
- Inside this Canvas preview the network is blocked, so the leaderboard will look empty and "Sign in" will do nothing. THAT IS EXPECTED — HallPass runs in "inert" mode here and every call safely does nothing. The game must still play perfectly.
- It turns on automatically once this game is published on HallPass (${baseUrl}) — no code change needed.
- Never wrap HallPass calls in try/catch expecting an error; nothing here throws. If a call did not land, read the result object (for example submitScore resolves to { ok: false, reason: "inert" }).

When you are done, tell me exactly which lines you added and where.`;
}
