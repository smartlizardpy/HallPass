/**
 * Builds the copy-paste prompt a HallPass admin hands to an AI agent (Gemini
 * Canvas, Claude Artifacts, etc.) to add ONLINE CO-OP to a game with the P2P
 * co-op SDK (`sdk/p2p`, served at `/sdk/p2p/v1/hallpass-p2p.js`).
 *
 * The co-op sibling of `integration-prompt.ts`, built the same way and for the
 * same reasons: it speaks to the agent that holds the game's HTML open, makes it
 * interview the human before touching code, and inlines every call it needs
 * rather than trusting a weak agent to read the docs. What differs is the SDK:
 *   - it is an ES module, so it is loaded with a dynamic `import()` inside a
 *     try/catch. A preview that blocks the import keeps a working single-player
 *     game with the co-op button hidden;
 *   - it DOES throw (`P2PError`, whose `message` is written for players), so
 *     the prompt asks for try/catch and on-screen messages, the opposite of the
 *     scoreboard prompt's "nothing here throws";
 *   - its HallPass endpoints are same-origin only, so co-op connects only once
 *     the game is served by HallPass. On localhost the SDK's `auto` transport
 *     switches to its local mode (tabs of one browser), which is what the
 *     prompt offers for testing.
 *
 * Every SDK call it names is checked against the published `.d.ts` by
 * `coop-prompt.test.ts`, so an API change cannot leave the prompt teaching a
 * method that no longer exists. Pure string builder; no I/O.
 */

export interface CoopPromptInput {
  /** The game's HallPass slug, passed as `gameId` (rooms are scoped per game). */
  gameId: string;
  /** Human title of the game. */
  title: string;
  /** Origin to load the SDK from, e.g. `https://hallpass.gg`. A trailing slash is dropped. */
  baseUrl: string;
}

/** Where the co-op SDK is served, relative to the HallPass origin. */
export const COOP_SDK_PATH = "/sdk/p2p/v1/hallpass-p2p.js";

/**
 * Produce the full, self-contained agent prompt for one game. The returned
 * string is meant to be copied as-is into an AI agent's chat.
 */
export function buildCoopPrompt(input: CoopPromptInput): string {
  const { gameId, title } = input;
  const baseUrl = input.baseUrl.replace(/\/+$/, "");
  const sdkUrl = `${baseUrl}${COOP_SDK_PATH}`;

  return `You built a browser game in this Canvas. Now UPDATE that same HTML artifact to add ONLINE CO-OP, so friends can play it together over the internet, using HallPass's co-op SDK. Players connect directly to each other (peer to peer, WebRTC); HallPass only helps them find each other, so the game needs no server. Keep everything you already made; only ADD co-op. Do NOT create a new file, and do NOT redesign or rewrite the game. Single-player must keep working exactly as it does now.

Use these exact values:
- gameId (this game's HallPass slug): ${gameId}
- Game: ${title}
- HallPass URL: ${baseUrl}
- Co-op SDK: ${sdkUrl}

STEP 1 — Ask me first, then wait.
Before you change any code, ask me these questions in your next message and STOP for my answers:
1. What do players do together? (for example: each controls their own character in the same level)
2. What must look the same for everyone? (player positions, enemies, pickups, doors, score, the level or its random seed, …)
3. How many players at most? (2 to 8; use 4 if I don't say)
4. Where should the "Play online" button go: the start screen, a menu, or a corner of the screen?
5. Do I want voice chat? (it is always off until a player turns it on)
6. Is HallPass's scoreboard script (window.HallPass, loaded from ${baseUrl}/sdk/v1/hallpass.js) already in this game? If it is, the lobby also gets an "Invite friends" button.
Do not guess and do not write any code yet. If I have not answered, ask again.

STEP 2 — After I answer, edit the artifact's HTML:

(a) Load the co-op SDK. It is an ES module. Add ONE <script type="module"> before </body> and put ALL the co-op code from the steps below inside it. Load the SDK with a dynamic import inside try/catch, so the game still runs anywhere it cannot load:

<script type="module">
  let HallPassP2P = null;
  try {
    ({ HallPassP2P } = await import("${sdkUrl}"));
  } catch (err) {
    console.warn("Online co-op is not available here:", err);
  }
  // HallPassP2P === null  ->  hide the "Play online" button; single-player as usual.
  // Expose only what the rest of the game needs, e.g. window.coop = { room, sendPosition, ... }.
</script>

(b) Connect, then Host or Join. When the player clicks "Play online", connect ONCE and reuse the client:

  const client = await HallPassP2P.connect({
    gameId: "${gameId}",
    gameVersion: "1",   // raise it whenever you change what is sent; players on another version get a clear error
    name: "Guest " + Math.floor(1000 + Math.random() * 9000),   // only used when the player is not signed in to HallPass
  });

Then show two buttons:
- Host:  const room = await client.createRoom({ maxPlayers: MAX_PLAYERS_I_TOLD_YOU, lockOnStart: true });
         show room.code big ("Room K7QX: tell your friends this code").
- Join:  a text box for the code, then  const room = await client.joinRoom(codeBox.value);
         (the SDK ignores case, spaces and dashes in the code).

THIS SDK THROWS, unlike HallPass's scoreboard SDK. Wrap connect, createRoom and joinRoom in try/catch and show err.message on screen: it is written for players (for example "That room doesn't exist"). Never leave a button doing nothing silently.

In the lobby, list room.players. Each player is { id, name, avatarUrl, isHost, isSelf, ready }. Re-draw the list on room.on("room-update", ...) and room.on("player-update", ...).

(c) Start together. Only the host sees a "Start" button:

  room.start({ seed: Math.floor(Math.random() * 1e9) });

Everyone, the host too, starts in the "start" event, on the same moment:

  room.on("start", ({ payload, startAt }) => {
    setTimeout(() => startTheGame(payload.seed), Math.max(0, startAt - room.now()));
  });

Use payload.seed for everything random that must match on every screen (level layout, enemy spawns).

(d) Keep the game in sync. The HOST is in charge.
- Every player sends their own position 15 to 20 times a second, over the unreliable channel (small: a few numbers):
    room.send("pos", { x, y, dir }, { reliable: false });
    room.on("pos", (data, meta) => { /* meta.from is the sender's id: move that player's figure */ });
  Move the other players' figures smoothly toward the newest position (lerp) instead of jumping.
- Draw each other player in another colour with their name above them. Create the figure when they join and remove it when they leave.
- Everything that must agree (enemies, pickups, doors, score, game over) is decided by the HOST only. The host runs it and sends the result reliably (the default), e.g. room.send("pickup-taken", { id }). Guests do not simulate those things themselves; they apply what the host sends.
- When a guest does something the host must approve (picking something up, opening a door), ask the host:
    // on the host, once:
    room.handle("pickup", (data, meta) => ({ ok: tryPickup(meta.from, data.id) }));
    // on anyone:
    const res = await room.request("host", "pickup", { id }, { timeoutMs: 3000 });
- Never send the whole game state every frame. Reliable messages are for events; unreliable ones for positions.

(e) Players coming and going:

  room.on("player-join", (player) => addPlayerFigure(player));
  room.on("player-leave", ({ id }) => removePlayerFigure(id));
  room.on("closed", ({ reason }) => backToMenu({
    "host-left": "The host left the game.",
    kicked: "You were removed from the room.",
    timeout: "Lost the connection to the host.",
    error: "Lost the connection to the host.",
  }[reason]));   // reason "left" means this player pressed Leave: no message needed

Add a "Leave" button that calls await room.leave() and goes back to the menu, and call room.leave() on window "pagehide". When the host leaves, the room ends for everyone (there is no host migration).

(f) Voice chat, ONLY if I said yes in answer 5. A "Voice chat" toggle that is OFF by default; turning it on must be a real click:

  await room.voice.start();          // asks for the microphone; throws with err.code "mic-denied" if refused
  room.voice.on("stream", ({ peerId, stream }) => {
    const audio = new Audio(); audio.srcObject = stream; audio.play();   // keep it by peerId
  });
  room.voice.on("stream-end", ({ peerId }) => { /* stop and drop that player's audio */ });
  room.voice.setMuted(true);         // a mute button;  room.voice.stop() turns voice off

(g) Invite friends, ONLY if the answer to question 6 is yes. HallPass shows its own friend picker; it works once the game is on HallPass:

  if (window.HallPass && HallPass.invite) {
    // an "Invite friends" button in the lobby, once a room exists:
    HallPass.invite({ data: { room: room.code } });   // resolves { sent, link, cancelled }; never throws
  }
  // On page load: a friend who opened the invite goes straight into that room.
  if (window.HallPass) HallPass.ready().then(() => {
    const launch = HallPass.getLaunch && HallPass.getLaunch();
    if (launch && launch.data && typeof launch.data.room === "string") joinRoomWithCode(launch.data.room);
  });

STEP 3 — Read this so you don't think it is broken:
- Inside this Canvas preview, co-op cannot connect: HallPass only connects players for games it hosts. connect, createRoom or joinRoom will fail, or the SDK will not load at all. THAT IS EXPECTED. Show the message, stay on the menu, and keep single-player perfect.
- To test it for real, open the game on localhost (a local web server) in TWO tabs of the same browser. There the SDK automatically uses its local mode: one tab hosts, the other joins with the code. No HallPass needed.
- It turns on by itself once this game is published on HallPass (${baseUrl}) as "${gameId}". No code change needed.
- Other players' messages come from their browsers. Check them before using them (numbers are numbers, ids exist), above all in the host's room.handle().
- Players in a room can see each other's IP address; that is how peer to peer works. Do not show it anywhere.

When you are done, tell me exactly which lines you added and where.`;
}
