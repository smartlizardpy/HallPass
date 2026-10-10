// HallPass P2P demo: coloured dots + chat. Also the manual test page.
// Plain ES module, no build step — exactly how a game would use the SDK.
import { HallPassP2P } from "../v1/hallpass-p2p.js";

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const COLORS = ["#e8590c", "#2f9e44", "#1971c2", "#c2255c", "#f08c00", "#6741d9", "#0c8599", "#5c940d"];

let client = null;
let room = null;
let ready = false;
let colorIndex = Math.floor(Math.random() * COLORS.length);
const dots = new Map(); // peerId -> { x, y, tx, ty }
const me = { x: 0.15 + Math.random() * 0.7, y: 0.15 + Math.random() * 0.7 };
const keys = new Set();
let audioCtx = null;
const voiceNodes = new Map(); // peerId -> GainNode
const mutedPeers = new Set();

$("ver").textContent = `SDK v${HallPassP2P.version}`;
$("name").value = params.get("name") || `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
if (params.get("transport")) $("transport").value = params.get("transport");
if (params.get("debug")) $("debug").checked = true;

function log(msg, cls = "") {
  const line = document.createElement("div");
  if (cls) line.className = cls;
  line.textContent = `${new Date().toLocaleTimeString()}  ${msg}`;
  $("log").append(line);
  $("log").scrollTop = $("log").scrollHeight;
}

function show(id, on) {
  $(id).classList.toggle("hidden", !on);
}

// ── connect ───────────────────────────────────────────────────────────────────

$("connectBtn").onclick = async () => {
  $("connectBtn").disabled = true;
  try {
    const lat = Number($("lat").value) || 0;
    const jit = Number($("jit").value) || 0;
    const loss = Number($("loss").value) || 0;
    client = await HallPassP2P.connect({
      gameId: "hallpass-p2p-demo",
      gameVersion: "1",
      name: $("name").value,
      transport: $("transport").value,
      relayOnly: $("relayOnly").checked,
      simulate: lat || jit || loss ? { latencyMs: lat, jitterMs: jit, lossPct: loss } : null,
      debug: $("debug").checked,
    });
    $("transportInfo").textContent = `· ${client.transport} transport · you are ${client.self.name} (${client.self.id})`;
    log(`connected via ${client.transport}`);
    show("connectBox", false);
    show("lobbyBox", true);
    if (params.get("join")) {
      $("code").value = params.get("join");
      $("joinBtn").click();
    }
  } catch (e) {
    log(`connect failed: ${e.message}`, "err");
    $("connectBtn").disabled = false;
  }
};

$("selfTestBtn").onclick = async () => {
  $("selfTestOut").classList.remove("hidden");
  $("selfTestOut").textContent = "Testing…";
  const r = await HallPassP2P.selfTest();
  $("selfTestOut").textContent = JSON.stringify(r, null, 2);
};

// ── create / join ─────────────────────────────────────────────────────────────

$("createBtn").onclick = async () => {
  try {
    enterRoom(await client.createRoom({
      maxPlayers: Number($("max").value) || 4,
      meta: { board: "dots" },
      lockOnStart: $("lockOnStart").checked,
    }));
  } catch (e) {
    $("joinErr").textContent = e.message;
  }
};

$("joinBtn").onclick = async () => {
  $("joinErr").textContent = "";
  $("joinBtn").disabled = true;
  try {
    enterRoom(await client.joinRoom($("code").value));
  } catch (e) {
    $("joinErr").textContent = `${e.message} (${e.code}${e.reason ? ", " + e.reason : ""})`;
  } finally {
    $("joinBtn").disabled = false;
  }
};

function enterRoom(r) {
  room = r;
  window.demoRoom = r; // handy in the console
  show("lobbyBox", false);
  show("roomBox", true);
  show("sideBox", true);
  $("roomCode").textContent = r.code;
  history.replaceState(null, "", `?join=${r.code}&transport=${client.transport}`);
  room.setPlayerMeta({ color: colorIndex });

  room.on("player-join", (p) => log(`${p.name} joined`));
  room.on("player-leave", ({ id, reason }) => {
    log(`${id} left (${reason})`);
    dots.delete(id);
    voiceNodes.get(id)?.disconnect();
    voiceNodes.delete(id);
  });
  room.on("player-update", () => renderPlayers());
  room.on("room-update", () => renderPlayers());
  room.on("start", ({ payload, startAt }) => {
    const wait = Math.max(0, startAt - room.now());
    log(`start ${JSON.stringify(payload)} in ${Math.round(wait)} ms`);
    setTimeout(() => log("GO (shared clock)"), wait);
  });
  room.on("visibility", ({ id, hidden }) => log(`${id} ${hidden ? "went to the background" : "is back"}`));
  room.on("host-left", () => log("the host left", "err"));
  room.on("kicked", ({ reason }) => log(`you were kicked: ${reason}`, "err"));
  room.on("closed", ({ reason }) => {
    log(`room closed (${reason})`, "err");
    room = null;
    show("roomBox", false);
    show("sideBox", false);
    show("lobbyBox", true);
  });
  room.on("error", (e) => log(`error: ${e.message}`, "err"));

  room.on("pos", (d, meta) => {
    const dot = dots.get(meta.from) ?? { x: d.x, y: d.y };
    dot.tx = d.x;
    dot.ty = d.y;
    dots.set(meta.from, dot);
  });
  room.on("chat", (text, meta) => {
    const who = room.players.find((p) => p.id === meta.from)?.name ?? meta.from;
    const line = document.createElement("div");
    line.textContent = `${who}: ${text}`;
    $("chat").append(line);
    $("chat").scrollTop = $("chat").scrollHeight;
  });
  room.handle("roll", (_data, meta) => ({ value: 1 + Math.floor(Math.random() * 6), for: meta.from }));
  room.voice.on("stream", ({ peerId, stream }) => attachVoice(peerId, stream));
  room.voice.on("stream-end", ({ peerId }) => {
    voiceNodes.get(peerId)?.disconnect();
    voiceNodes.delete(peerId);
    log(`voice from ${peerId} ended`);
  });
  renderPlayers();
}

// ── lobby controls ────────────────────────────────────────────────────────────

$("readyBtn").onclick = () => {
  ready = !ready;
  room.setReady(ready);
  $("readyBtn").textContent = ready ? "Not ready" : "Ready";
};
$("colorBtn").onclick = () => {
  colorIndex = (colorIndex + 1) % COLORS.length;
  room.setPlayerMeta({ color: colorIndex });
};
$("lockBtn").onclick = () => (room.locked ? room.unlock() : room.lock());
$("startBtn").onclick = () => room.start({ seed: Math.floor(Math.random() * 1e6) });
$("leaveBtn").onclick = () => room.leave();

function renderPlayers() {
  if (!room) return;
  $("roomFlags").textContent = [room.locked && "locked", room.started && "started", `${room.players.length}/${room.maxPlayers}`]
    .filter(Boolean)
    .join(" · ");
  $("lockBtn").textContent = room.locked ? "Unlock" : "Lock";
  for (const el of document.querySelectorAll(".hostOnly")) el.classList.toggle("hidden", !room.isHost);
  const tbody = $("players");
  tbody.textContent = "";
  for (const p of room.players) {
    const tr = document.createElement("tr");
    const c = p.connection;
    const swatch = `<span class="pill" style="background:${COLORS[p.meta.color ?? 0]};border-color:transparent">&nbsp;</span>`;
    tr.innerHTML = `<td>${swatch} <span class="n"></span>${p.isHost ? ' <span class="pill">host</span>' : ""}${p.isSelf ? ' <span class="pill">you</span>' : ""}${p.hidden ? ' <span class="pill">away</span>' : ""}</td>
      <td>${p.ready ? "✓" : ""}</td>
      <td class="${c.state}">${p.isSelf ? "" : c.state + (c.relay ? " (relay)" : "")}</td>
      <td>${p.isSelf || c.rttMs == null ? "" : c.rttMs + " ms"}</td><td></td>`;
    tr.querySelector(".n").textContent = p.name;
    const actions = tr.lastElementChild;
    if (room.isHost && !p.isSelf) {
      const kick = document.createElement("button");
      kick.className = "ghost";
      kick.textContent = "Kick";
      kick.onclick = () => room.kick(p.id, "kicked from the demo");
      actions.append(kick);
    }
    if (!p.isSelf && voiceNodes.has(p.id)) {
      const mute = document.createElement("button");
      mute.className = "ghost";
      mute.textContent = mutedPeers.has(p.id) ? "Unmute" : "Mute";
      mute.onclick = () => {
        const muted = !mutedPeers.has(p.id);
        if (muted) mutedPeers.add(p.id);
        else mutedPeers.delete(p.id);
        room.voice.setPeerMuted(p.id, muted);
        renderPlayers();
      };
      actions.append(mute);
    }
    tbody.append(tr);
  }
}
setInterval(renderPlayers, 1000); // RTT changes do not raise events

// ── chat, request, voice, stats ───────────────────────────────────────────────

function sendChat() {
  const text = $("chatIn").value.trim();
  if (!text || !room) return;
  room.send("chat", text, { to: "all" });
  $("chatIn").value = "";
}
$("chatBtn").onclick = sendChat;
$("chatIn").onkeydown = (e) => e.key === "Enter" && sendChat();

$("rollBtn").onclick = async () => {
  try {
    const res = await room.request("host", "roll", null, { timeoutMs: 3000 });
    log(`host rolled ${res.value}`);
  } catch (e) {
    log(`roll failed: ${e.message}`, "err");
  }
};

$("voiceBtn").onclick = async () => {
  if (room.voice.active) {
    room.voice.stop();
    $("voiceBtn").textContent = "Start voice";
    $("muteBtn").disabled = true;
    return;
  }
  audioCtx ??= new AudioContext();
  await audioCtx.resume();
  try {
    await room.voice.start({ echoCancellation: true, noiseSuppression: true });
    $("voiceBtn").textContent = "Stop voice";
    $("muteBtn").disabled = false;
  } catch (e) {
    log(e.message, "err");
  }
};
$("muteBtn").onclick = () => {
  room.voice.setMuted(!room.voice.muted);
  $("muteBtn").textContent = room.voice.muted ? "Unmute me" : "Mute me";
};

function attachVoice(peerId, stream) {
  // Games would use a PannerNode here for positional audio. The SDK already
  // attached the stream to a muted <audio> element for Chrome's quirk.
  audioCtx ??= new AudioContext();
  void audioCtx.resume();
  const gain = audioCtx.createGain();
  audioCtx.createMediaStreamSource(stream).connect(gain).connect(audioCtx.destination);
  voiceNodes.set(peerId, gain);
  log(`voice from ${peerId}`);
  renderPlayers();
}

$("statsBtn").onclick = async () => {
  $("statsOut").textContent = JSON.stringify(await room.stats(), null, 2);
};

// ── the board ─────────────────────────────────────────────────────────────────

const canvas = $("board");
const ctx = canvas.getContext("2d");
addEventListener("keydown", (e) => {
  if (document.activeElement?.tagName === "INPUT") return;
  keys.add(e.key.toLowerCase());
});
addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
canvas.addEventListener("pointermove", (e) => {
  if (!e.buttons) return;
  const r = canvas.getBoundingClientRect();
  me.x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  me.y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
});

let last = performance.now();
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  const v = 0.45 * dt;
  if (keys.has("arrowleft") || keys.has("a")) me.x = Math.max(0, me.x - v);
  if (keys.has("arrowright") || keys.has("d")) me.x = Math.min(1, me.x + v);
  if (keys.has("arrowup") || keys.has("w")) me.y = Math.max(0, me.y - v);
  if (keys.has("arrowdown") || keys.has("s")) me.y = Math.min(1, me.y + v);

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (room) {
    for (const p of room.players) {
      const d = p.isSelf ? me : dots.get(p.id);
      if (!d) continue;
      if (!p.isSelf && d.tx != null) {
        d.x += (d.tx - d.x) * 0.25; // smooth between 20 Hz updates
        d.y += (d.ty - d.y) * 0.25;
      }
      const x = d.x * canvas.width;
      const y = d.y * canvas.height;
      ctx.fillStyle = COLORS[p.meta.color ?? 0];
      ctx.beginPath();
      ctx.arc(x, y, p.isSelf ? 14 : 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = getComputedStyle(document.body).color;
      ctx.font = "12px system-ui";
      ctx.fillText(p.name, x + 16, y + 4);
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

setInterval(() => {
  if (room) room.send("pos", { x: me.x, y: me.y }, { reliable: false });
}, 50);

if (params.get("join")) $("connectBtn").click();
