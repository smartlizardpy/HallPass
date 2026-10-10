/* HallPass P2P SDK v1.0.0 — peer-to-peer co-op for HallPass games — https://hallpass.gg/sdk/p2p/v1/ — MIT */

// sdk/p2p/src/codes.ts
var CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
var CODE_LENGTH = 4;
var CODE_RE = /^[A-HJ-NP-Z2-9]{4}$/;
var MAX_PLAYERS = 8;
var DEMO_GAME_ID = "hallpass-p2p-demo";
var GAME_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
function randomInt(n) {
  const buf = new Uint32Array(1);
  globalThis.crypto.getRandomValues(buf);
  return buf[0] % n;
}
function generateCode() {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}
function normalizeCode(input) {
  if (typeof input !== "string") return null;
  const code = input.trim().toUpperCase().replace(/[\s-]/g, "");
  return CODE_RE.test(code) ? code : null;
}
function isValidGameId(id) {
  return typeof id === "string" && GAME_ID_RE.test(id);
}
function generateSecret() {
  const buf = new Uint8Array(16);
  globalThis.crypto.getRandomValues(buf);
  let hex = "";
  for (const b of buf) hex += b.toString(16).padStart(2, "0");
  return hex;
}
var B32 = "abcdefghijklmnopqrstuvwxyz234567";
async function derivePeerId(secret) {
  const data = new TextEncoder().encode("hallpass-p2p:" + secret);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", data));
  let bits = 0;
  let value = 0;
  let out = "";
  for (let i = 0; out.length < 12; ) {
    if (bits < 5) {
      value = value << 8 | digest[i++];
      bits += 8;
    }
    out += B32[value >>> bits - 5 & 31];
    bits -= 5;
  }
  return out;
}
function sanitizeName(input, fallback = "Player") {
  if (typeof input !== "string") return fallback;
  const clean = input.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, "").replace(/\s+/g, " ").trim().slice(0, 24).trim();
  return clean || fallback;
}
function sanitizeVersion(input) {
  return typeof input === "string" ? input.trim().slice(0, 32) : "";
}

// sdk/p2p/src/env.ts
var g = globalThis;
var env = {
  RTCPeerConnection: g.RTCPeerConnection,
  MediaStream: g.MediaStream,
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c),
  /** Epoch milliseconds from the monotonic clock. */
  now: () => performance.timeOrigin + performance.now(),
  random: () => Math.random()
};
var hasDocument = () => typeof document !== "undefined";

// sdk/p2p/src/errors.ts
var P2PError = class extends Error {
  constructor(code, message, reason) {
    super(message);
    this.name = "P2PError";
    this.code = code;
    if (reason) this.reason = reason;
  }
};
var REASONS = {
  "no-turn-restrictive-network": "Couldn't connect to the other player. Your network (often a school or office network) blocks direct connections, and no relay server is available.",
  "turn-failed": "Couldn't connect, even through the relay server. Check your internet connection and try again.",
  "relay-unavailable": "Private relay mode is on, but no relay server is available right now, so you can't connect.",
  "peer-unreachable": "Connected to the host, but couldn't reach every other player in the room.",
  "signaling-unreachable": "Couldn't reach HallPass to set up the game. Check your internet connection and try again.",
  "signaling-unavailable": "Online play is unavailable on HallPass right now. Try again later.",
  "rate-limited": "Too many attempts. Wait a minute, then try again.",
  "unknown-game": "HallPass doesn't recognise this game, so it can't host a room for it.",
  "room-closed": "The room closed while you were joining.",
  "registration-lost": "This room can no longer take new players (HallPass stopped hearing from it, often because the tab was asleep). Players already here can keep playing."
};
function connectFailed(reason) {
  return new P2PError("connect-failed", REASONS[reason] ?? REASONS["signaling-unreachable"], reason);
}
function roomError(code, extra) {
  switch (code) {
    case "room-not-found":
      return new P2PError(
        code,
        extra?.code ? `No room with code ${extra.code} is open. Check the code and try again.` : "That room isn't open. Check the code and try again."
      );
    case "room-full":
      return new P2PError(code, "That room is full.");
    case "room-locked":
      return extra?.reason === "kicked" ? new P2PError(code, "You were removed from that room.", "kicked") : new P2PError(code, "That room is locked, or its game has already started.");
    case "version-mismatch":
      return new P2PError(
        code,
        extra?.hostVersion ? `The host is running version ${extra.hostVersion} of the game and you have ${extra.mine || "another version"}. Reload the page to update, then try again.` : "You and the host are running different versions of the game. Reload the page to update, then try again."
      );
    case "timeout":
      return new P2PError(code, "The host didn't respond. They may have left, or their tab may be asleep.");
    default:
      return new P2PError(code, "Something went wrong with the connection.");
  }
}

// sdk/p2p/src/clock.ts
var KEEP = 24;
var BEST = 5;
var ClockSync = class {
  constructor() {
    this.samples = [];
  }
  add(sentAt, hostTime, receivedAt) {
    const rtt = receivedAt - sentAt;
    if (!(rtt >= 0) || !Number.isFinite(hostTime)) return;
    this.samples.push({ rtt, offset: hostTime + rtt / 2 - receivedAt });
    if (this.samples.length > KEEP) this.samples.shift();
  }
  get size() {
    return this.samples.length;
  }
  /** Estimated `hostClock - localClock`, or `null` before the first sample. */
  offset() {
    if (!this.samples.length) return null;
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, BEST);
    const offs = best.map((s) => s.offset).sort((a, b) => a - b);
    const mid = offs.length >> 1;
    return offs.length % 2 ? offs[mid] : (offs[mid - 1] + offs[mid]) / 2;
  }
};
function smooth(prev, sample) {
  return prev == null ? sample : prev * 0.7 + sample * 0.3;
}

// sdk/p2p/src/emitter.ts
var Emitter = class {
  constructor(onHandlerError = () => {
  }) {
    this.onHandlerError = onHandlerError;
    this.map = /* @__PURE__ */ new Map();
    this.queue = [];
    this.scheduled = false;
  }
  on(event, fn) {
    let set = this.map.get(event);
    if (!set) this.map.set(event, set = /* @__PURE__ */ new Set());
    set.add(fn);
    return () => this.off(event, fn);
  }
  off(event, fn) {
    this.map.get(event)?.delete(fn);
  }
  has(event) {
    return (this.map.get(event)?.size ?? 0) > 0;
  }
  emit(event, ...args) {
    this.queue.push([event, args]);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.drain());
    }
  }
  /** Deliver to one listener only, asynchronously (used to replay state to late subscribers). */
  emitTo(fn, ...args) {
    queueMicrotask(() => {
      try {
        fn(...args);
      } catch (err) {
        this.onHandlerError(err, "");
      }
    });
  }
  clear() {
    this.map.clear();
  }
  drain() {
    this.scheduled = false;
    const batch = this.queue;
    this.queue = [];
    for (const [event, args] of batch) {
      const set = this.map.get(event);
      if (!set) continue;
      for (const fn of [...set]) {
        try {
          fn(...args);
        } catch (err) {
          this.onHandlerError(err, event);
        }
      }
    }
  }
};

// sdk/p2p/src/wire.ts
var CHUNK_BYTES = 16 * 1024;
var MAX_RELIABLE_BYTES = 256 * 1024;
var MAX_UNRELIABLE_BYTES = 16 * 1024;
var BIN = 177;
var CHUNK = 193;
var CHUNK_HEAD = 10;
var TYPES = [
  "ArrayBuffer",
  "Uint8Array",
  "Int8Array",
  "Uint8ClampedArray",
  "Int16Array",
  "Uint16Array",
  "Int32Array",
  "Uint32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "DataView"
];
var enc = new TextEncoder();
var dec = new TextDecoder();
function isBinary(v) {
  return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
}
function encode(header, body) {
  if (isBinary(body)) {
    const name = body instanceof ArrayBuffer ? "ArrayBuffer" : body.constructor.name;
    let tag = TYPES.indexOf(name);
    if (tag < 0) tag = 1;
    const bytes = body instanceof ArrayBuffer ? new Uint8Array(body) : new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
    const head = enc.encode(JSON.stringify(header));
    const out = new Uint8Array(4 + head.length + bytes.length);
    out[0] = BIN;
    out[1] = tag;
    out[2] = head.length & 255;
    out[3] = head.length >> 8;
    out.set(head, 4);
    out.set(bytes, 4 + head.length);
    return out;
  }
  let text;
  try {
    text = JSON.stringify([...header, body === void 0 ? null : body]);
  } catch {
    text = void 0;
  }
  if (typeof text !== "string") {
    throw new P2PError("invalid-argument", "This message can't be sent: its data is not JSON-serialisable.");
  }
  return text;
}
function decode(frame) {
  try {
    if (typeof frame === "string") {
      const arr = JSON.parse(frame);
      if (!Array.isArray(arr) || arr.length < 2) return null;
      return { header: arr.slice(0, -1), body: arr[arr.length - 1] };
    }
    const u8 = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
    if (u8[0] !== BIN) return null;
    const hlen = u8[2] | u8[3] << 8;
    const header = JSON.parse(dec.decode(u8.subarray(4, 4 + hlen)));
    const payload = u8.slice(4 + hlen).buffer;
    const name = TYPES[u8[1]] ?? "Uint8Array";
    if (name === "ArrayBuffer") return { header, body: payload };
    const Ctor = globalThis[name];
    return { header, body: Ctor ? new Ctor(payload) : new Uint8Array(payload) };
  } catch {
    return null;
  }
}
function frameSize(frame) {
  if (typeof frame === "string") return frame.length * 3 <= CHUNK_BYTES ? frame.length : enc.encode(frame).length;
  return frame.length;
}
function isChunk(data) {
  const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
  return u8[0] === CHUNK;
}
function split(frame, messageId) {
  const text = typeof frame === "string";
  const bytes = text ? enc.encode(frame) : frame;
  const per = CHUNK_BYTES - CHUNK_HEAD;
  const count = Math.ceil(bytes.length / per);
  const out = [];
  for (let i = 0; i < count; i++) {
    const part = bytes.subarray(i * per, Math.min(bytes.length, (i + 1) * per));
    const c = new Uint8Array(CHUNK_HEAD + part.length);
    const dv = new DataView(c.buffer);
    c[0] = CHUNK;
    c[1] = text ? 1 : 0;
    dv.setUint32(2, messageId >>> 0, true);
    dv.setUint16(6, i, true);
    dv.setUint16(8, count, true);
    c.set(part, CHUNK_HEAD);
    out.push(c);
  }
  return out;
}
var Reassembler = class {
  constructor() {
    this.id = -1;
    this.parts = [];
    this.size = 0;
  }
  /** Feed one chunk; returns the whole frame when its last chunk arrives. */
  push(data) {
    const u8 = data instanceof Uint8Array ? data : new Uint8Array(data);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const id = dv.getUint32(2, true);
    const index = dv.getUint16(6, true);
    const count = dv.getUint16(8, true);
    if (index === 0) {
      this.id = id;
      this.parts = [];
      this.size = 0;
    } else if (id !== this.id || index !== this.parts.length) {
      this.id = -1;
      this.parts = [];
      return null;
    }
    const part = u8.slice(CHUNK_HEAD);
    this.parts.push(part);
    this.size += part.length;
    if (this.size > MAX_RELIABLE_BYTES + CHUNK_BYTES) {
      this.id = -1;
      this.parts = [];
      return null;
    }
    if (index + 1 < count) return null;
    const whole = new Uint8Array(this.size);
    let off = 0;
    for (const p of this.parts) {
      whole.set(p, off);
      off += p.length;
    }
    this.id = -1;
    this.parts = [];
    return u8[1] & 1 ? dec.decode(whole) : whole;
  }
};

// sdk/p2p/src/peer.ts
var HIGH_WATER = 1 << 20;
var LOW_WATER = 256 << 10;
var MAX_QUEUED = 16 << 20;
var UNRELIABLE_DROP = 64 << 10;
var PeerLink = class {
  constructor(id, polite, initiator, config, sim, hooks) {
    this.id = id;
    this.polite = polite;
    this.sim = sim;
    this.hooks = hooks;
    this.state = "connecting";
    /** Remote description applied at least once: the other side answered. */
    this.negotiated = false;
    /** ICE reported `failed` before the link ever opened. */
    this.failed = false;
    this.relay = false;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.audioSender = null;
    this.queue = [];
    this.queued = 0;
    this.msgId = 0;
    this.reasm = new Reassembler();
    this.makingOffer = false;
    this.ignoreOffer = false;
    this.answerPending = false;
    this.chain = Promise.resolve();
    this.early = [];
    this.simQ = [];
    this.simLast = 0;
    this.pump = () => {
      this.simTimer = void 0;
      const now = env.now();
      while (this.simQ.length && this.simQ[0][0] <= now) this.enqueue(this.simQ.shift()[1]);
      if (this.simQ.length) this.simTimer = setTimeout(this.pump, Math.max(1, this.simQ[0][0] - now));
    };
    const PC = env.RTCPeerConnection;
    if (!PC) throw new P2PError("unsupported", "This browser doesn't support peer-to-peer connections (WebRTC).");
    const pc = this.pc = new PC(config);
    pc.onicecandidate = (e) => {
      if (e.candidate) hooks.signal({ k: "rtc", c: e.candidate.toJSON() });
    };
    pc.onnegotiationneeded = () => void this.offer();
    pc.oniceconnectionstatechange = () => this.update();
    pc.onconnectionstatechange = () => this.update();
    pc.ontrack = (e) => hooks.track(e);
    if (initiator) this.channels();
  }
  get open() {
    return this.state === "open";
  }
  /** Apply a signal from the remote side. Serialised: one at a time, in order. */
  signal(msg) {
    this.chain = this.chain.then(() => this.apply(msg)).catch((e) => this.hooks.log("signal failed", this.id, e));
  }
  /** Send a frame. Reliable frames queue under backpressure; unreliable ones drop. */
  send(frame, reliable) {
    if (this.state === "closed") return;
    if (!reliable) {
      const ch = this.unrel;
      if (this.state !== "open" || !ch || ch.readyState !== "open" || ch.bufferedAmount > UNRELIABLE_DROP) return;
      this.transmit(frame, false);
      return;
    }
    if (this.queued > MAX_QUEUED) {
      throw new P2PError(
        "send-buffer-full",
        "Too much data is waiting to be sent to another player. Send less, or less often."
      );
    }
    if (frameSize(frame) > CHUNK_BYTES) for (const part of split(frame, this.msgId++)) this.transmit(part, true);
    else this.transmit(frame, true);
  }
  /** Close once the reliable channel has drained (≤ `maxMs`), so a last `bye` gets out. */
  closeSoon(maxMs = 400) {
    const start = env.now();
    const tick = () => {
      if (this.state === "closed") return;
      if (!this.queue.length && (this.rel?.bufferedAmount ?? 0) === 0 && env.now() - start > 50) return this.close();
      if (env.now() - start > maxMs) return this.close();
      setTimeout(tick, 25);
    };
    tick();
  }
  close() {
    if (this.state === "closed") return;
    this.state = "closed";
    clearTimeout(this.restartTimer);
    clearTimeout(this.simTimer);
    try {
      this.rel?.close();
      this.unrel?.close();
      this.pc.close();
    } catch {
    }
    this.hooks.state("closed");
  }
  /** Add (or swap) the local voice track; `null` stops sending without renegotiating. */
  setAudio(track, stream) {
    if (this.state === "closed") return;
    try {
      if (this.audioSender) void this.audioSender.replaceTrack(track);
      else if (track && stream) this.audioSender = this.pc.addTrack(track, stream);
    } catch (e) {
      this.hooks.log("audio track failed", this.id, e);
    }
  }
  async stats() {
    const out = { rttMs: null, bytesIn: this.bytesIn, bytesOut: this.bytesOut, relay: this.relay };
    try {
      const report = await this.pc.getStats();
      let pair;
      report.forEach((s) => {
        if (s.type === "transport" && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId);
      });
      if (!pair) {
        report.forEach((s) => {
          if (s.type === "candidate-pair" && s.state === "succeeded" && (s.selected || s.nominated)) pair = s;
        });
      }
      if (pair) {
        const local = report.get(pair.localCandidateId);
        const remote = report.get(pair.remoteCandidateId);
        this.relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
        out.relay = this.relay;
        if (typeof pair.currentRoundTripTime === "number") out.rttMs = pair.currentRoundTripTime * 1e3;
        if (typeof pair.bytesReceived === "number") out.bytesIn = pair.bytesReceived;
        if (typeof pair.bytesSent === "number") out.bytesOut = pair.bytesSent;
      }
    } catch {
    }
    return out;
  }
  // ── negotiation ────────────────────────────────────────────────────────────
  async offer() {
    if (this.state === "closed") return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      this.emitDescription();
    } catch (e) {
      this.hooks.log("offer failed", this.id, e);
    } finally {
      this.makingOffer = false;
    }
  }
  emitDescription() {
    const d = this.pc.localDescription;
    if (d) this.hooks.signal({ k: "rtc", d: { type: d.type, sdp: d.sdp } });
  }
  async apply({ d, c }) {
    if (this.state === "closed") return;
    const pc = this.pc;
    if (d) {
      const ready = !this.makingOffer && (pc.signalingState === "stable" || this.answerPending);
      const collision = d.type === "offer" && !ready;
      this.ignoreOffer = !this.polite && collision;
      if (this.ignoreOffer) return;
      this.answerPending = d.type === "answer";
      await pc.setRemoteDescription(d);
      this.answerPending = false;
      this.negotiated = true;
      if (d.type === "offer") {
        this.channels();
        await pc.setLocalDescription();
        this.emitDescription();
      }
      for (const cand of this.early.splice(0)) await this.candidate(cand);
    } else if (c) {
      if (!pc.remoteDescription) this.early.push(c);
      else await this.candidate(c);
    }
  }
  async candidate(c) {
    try {
      await this.pc.addIceCandidate(c);
    } catch (e) {
      if (!this.ignoreOffer) this.hooks.log("candidate rejected", this.id, e);
    }
  }
  channels() {
    if (this.rel) return;
    const rel = this.pc.createDataChannel("hp-r", { negotiated: true, id: 0, ordered: true });
    const unrel = this.pc.createDataChannel("hp-u", { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.rel = rel;
    this.unrel = unrel;
    for (const [ch, reliable] of [
      [rel, true],
      [unrel, false]
    ]) {
      ch.binaryType = "arraybuffer";
      ch.onmessage = (e) => this.receive(e.data, reliable);
      ch.onopen = () => this.update();
    }
    rel.onclose = () => this.close();
    rel.bufferedAmountLowThreshold = LOW_WATER;
    rel.onbufferedamountlow = () => this.flush();
  }
  update() {
    if (this.state === "closed") return;
    const ice = this.pc.iceConnectionState;
    const conn = this.pc.connectionState;
    if (conn === "closed") return this.close();
    const up = (ice === "connected" || ice === "completed") && this.rel?.readyState === "open";
    const down = ice === "disconnected" || ice === "failed" || conn === "failed";
    if (up && this.state !== "open") {
      this.state = "open";
      clearTimeout(this.restartTimer);
      this.flush();
      this.hooks.state("open");
    } else if (down && this.state === "open") {
      this.state = "disrupted";
      this.hooks.state("disrupted");
      this.restartIn(this.polite ? 5e3 : 1500);
    } else if (ice === "failed" && this.state === "connecting") {
      this.failed = true;
      this.hooks.state("connecting");
    }
  }
  restartIn(ms) {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(async () => {
      if (this.state !== "disrupted") return;
      try {
        if (this.pc.signalingState === "have-local-offer") await this.pc.setLocalDescription({ type: "rollback" });
        this.hooks.log("ICE restart", this.id);
        this.pc.restartIce();
      } catch (e) {
        this.hooks.log("ICE restart failed", this.id, e);
      }
      this.restartIn(4e3);
    }, ms);
  }
  // ── frames ─────────────────────────────────────────────────────────────────
  receive(data, reliable) {
    if (this.state === "closed") return;
    this.bytesIn += typeof data === "string" ? data.length : data.byteLength;
    if (typeof data !== "string" && isChunk(data)) {
      const whole = this.reasm.push(data);
      if (whole !== null) this.hooks.frame(whole, true);
      return;
    }
    this.hooks.frame(data, reliable);
  }
  /** Apply simulated network conditions (local transport), then hand to the channel. */
  transmit(frame, reliable) {
    const sim = this.sim;
    if (!sim) return reliable ? this.enqueue(frame) : this.raw(this.unrel, frame);
    if (!reliable && env.random() * 100 < (sim.lossPct ?? 0)) return;
    let at = env.now() + (sim.latencyMs ?? 0) + env.random() * (sim.jitterMs ?? 0);
    if (!reliable) {
      setTimeout(() => this.unrel?.readyState === "open" && this.raw(this.unrel, frame), at - env.now());
      return;
    }
    at = Math.max(at, this.simLast);
    this.simLast = at;
    this.simQ.push([at, frame]);
    if (!this.simTimer) this.pump();
  }
  enqueue(frame) {
    const ch = this.rel;
    if (!this.queue.length && ch?.readyState === "open" && ch.bufferedAmount < HIGH_WATER) {
      this.raw(ch, frame);
      return;
    }
    this.queue.push(frame);
    this.queued += frameSize(frame);
  }
  flush() {
    const ch = this.rel;
    if (!ch || ch.readyState !== "open") return;
    while (this.queue.length && ch.bufferedAmount < HIGH_WATER) {
      const f = this.queue.shift();
      this.queued -= frameSize(f);
      this.raw(ch, f);
    }
  }
  raw(ch, frame) {
    if (!ch || ch.readyState !== "open") return;
    try {
      ch.send(frame);
      this.bytesOut += typeof frame === "string" ? frame.length : frame.byteLength;
    } catch (e) {
      this.hooks.log("send failed", this.id, e);
    }
  }
};

// sdk/p2p/src/voice.ts
var VoiceImpl = class {
  constructor(room, log) {
    this.room = room;
    this.log = log;
    this.ev = new Emitter((e) => console.error("[hallpass-p2p] voice handler threw:", e));
    this.stream = null;
    this.track = null;
    this.isMuted = false;
    this.remote = /* @__PURE__ */ new Map();
  }
  get active() {
    return !!this.track;
  }
  get muted() {
    return this.isMuted;
  }
  async start(opts = {}) {
    if (this.track) return;
    if (this.room.closed) throw new P2PError("closed", "You're no longer in this room.");
    let stream;
    try {
      stream = await env.getUserMedia({
        audio: {
          echoCancellation: opts.echoCancellation ?? true,
          noiseSuppression: opts.noiseSuppression ?? true,
          autoGainControl: opts.autoGainControl ?? true
        },
        video: false
      });
    } catch (e) {
      const name = e?.name;
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new P2PError("mic-denied", "Microphone access was blocked. Allow it in your browser's site settings to use voice chat.");
      }
      throw new P2PError("mic-unavailable", "No microphone was found, or another app is using it.");
    }
    const track = stream.getAudioTracks()[0];
    if (this.room.closed || !track) {
      stream.getTracks().forEach((t) => t.stop());
      throw new P2PError("mic-unavailable", "No microphone was found, or another app is using it.");
    }
    this.stream = stream;
    this.track = track;
    track.enabled = !this.isMuted;
    this.room.forEachOpenLink((l) => this.linkOpen(l));
  }
  stop() {
    if (!this.track) return;
    this.track.stop();
    this.track = null;
    this.stream = null;
    this.room.forEachOpenLink((l) => {
      l.setAudio(null);
      this.room.control(l, "voice", false);
    });
  }
  setMuted(muted) {
    this.isMuted = !!muted;
    if (this.track) this.track.enabled = !this.isMuted;
  }
  setPeerMuted(peerId, muted) {
    const r = this.get(peerId);
    r.muted = !!muted;
    this.applyMute(r);
  }
  on(event, cb) {
    const off = this.ev.on(event, cb);
    if (event === "stream") {
      for (const [peerId, r] of this.remote) {
        if (r.emitted && r.stream) this.ev.emitTo(cb, { peerId, stream: r.stream });
      }
    }
    return off;
  }
  // ── hooks from the room ────────────────────────────────────────────────────
  /**
   * A link (re)opened: make sure it carries our voice if voice is on. Audio is
   * only ever added to an OPEN link, so the first offer/answer is never
   * complicated by a second negotiation.
   */
  linkOpen(link) {
    if (!this.track || !this.stream || link.state !== "open") return;
    link.setAudio(this.track, this.stream);
    this.room.control(link, "voice", true);
  }
  onTrack(peerId, e) {
    if (e.track.kind !== "audio") return;
    const r = this.get(peerId);
    const MS = env.MediaStream;
    r.stream = e.streams[0] ?? (MS ? new MS([e.track]) : void 0);
    this.applyMute(r);
    this.check(peerId);
  }
  remoteFlag(peerId, on) {
    this.get(peerId).on = on;
    this.check(peerId);
  }
  detach(peerId) {
    const r = this.remote.get(peerId);
    if (!r) return;
    if (r.emitted) this.ev.emit("stream-end", { peerId });
    if (r.el) r.el.srcObject = null;
    this.remote.delete(peerId);
  }
  shutdown() {
    this.stop();
    for (const id of [...this.remote.keys()]) this.detach(id);
  }
  get(peerId) {
    let r = this.remote.get(peerId);
    if (!r) this.remote.set(peerId, r = { on: false, emitted: false, muted: false });
    return r;
  }
  applyMute(r) {
    r.stream?.getAudioTracks().forEach((t) => t.enabled = !r.muted);
  }
  check(peerId) {
    const r = this.remote.get(peerId);
    if (!r) return;
    if (r.on && r.stream && !r.emitted) {
      r.emitted = true;
      if (!r.el && typeof Audio !== "undefined") {
        try {
          const el = new Audio();
          el.muted = true;
          el.srcObject = r.stream;
          void el.play().catch(() => {
          });
          r.el = el;
        } catch (e) {
          this.log("audio element failed", e);
        }
      }
      this.ev.emit("stream", { peerId, stream: r.stream });
    } else if (!r.on && r.emitted) {
      r.emitted = false;
      this.ev.emit("stream-end", { peerId });
    }
  }
};

// sdk/p2p/src/room.ts
var RESERVED = /* @__PURE__ */ new Set([
  "player-join",
  "player-leave",
  "player-update",
  "room-update",
  "start",
  "host-left",
  "kicked",
  "closed",
  "visibility",
  "error"
]);
var DROP_AFTER_MS = 1e4;
var PENDING_TIMEOUT_MS = 3e4;
var START_LEAD_MS = 500;
var PING_EVERY_MS = 2e3;
var MAX_PLAYER_META = 4096;
var MAX_ROOM_META = 8192;
var clone = (v) => v === void 0 ? v : JSON.parse(JSON.stringify(v));
var jsonSize = (v) => JSON.stringify(v ?? null).length;
var isObj = (v) => !!v && typeof v === "object" && !Array.isArray(v);
var RoomImpl = class {
  constructor(d) {
    this.d = d;
    this.closed = false;
    this.links = /* @__PURE__ */ new Map();
    this.lockOnStart = false;
    // host-only bookkeeping
    this.pendingJoins = /* @__PURE__ */ new Map();
    this.kicked = /* @__PURE__ */ new Set();
    this.byes = /* @__PURE__ */ new Set();
    this.early = /* @__PURE__ */ new Map();
    // joiner-only
    this.phase = "joined";
    this.dial = /* @__PURE__ */ new Set();
    this.welcomed = false;
    this.meshedSent = false;
    this.held = [];
    // timers, clock, requests
    this.dropTimers = /* @__PURE__ */ new Map();
    this.pings = /* @__PURE__ */ new Map();
    this.rtt = /* @__PURE__ */ new Map();
    this.clock = new ClockSync();
    this.lastNow = 0;
    this.reqSeq = 0;
    this.reqs = /* @__PURE__ */ new Map();
    this.handlers = /* @__PURE__ */ new Map();
    this.hidden = false;
    this.unlisten = [];
    this.code = d.code;
    this.selfId = d.selfId;
    this.hostId = d.hostId;
    this.isHost = d.isHost;
    this.ev = new Emitter((err, event) => {
      if (event === "error") return console.error("[hallpass-p2p] an 'error' handler threw:", err);
      const e = new P2PError("handler-error", `A "${event}" handler threw: ${err instanceof Error ? err.message : String(err)}`);
      e.cause = err;
      this.ev.emit("error", e);
    });
    const empty = { rev: 0, host: d.hostId, meta: {}, locked: false, started: false, max: 4, players: [], pending: [], start: null };
    this.view = empty;
    this.st = clone(empty);
    this.voice = new VoiceImpl(this, d.log);
    if (hasDocument()) {
      this.hidden = document.visibilityState === "hidden";
      const onVis = () => this.setHidden(document.visibilityState === "hidden");
      const onHide = () => this.pageGone();
      document.addEventListener("visibilitychange", onVis);
      addEventListener("pagehide", onHide);
      this.unlisten.push(
        () => document.removeEventListener("visibilitychange", onVis),
        () => removeEventListener("pagehide", onHide)
      );
    }
  }
  // ── public getters ─────────────────────────────────────────────────────────
  get meta() {
    return clone(this.view.meta);
  }
  get locked() {
    return this.view.locked;
  }
  get started() {
    return this.view.started;
  }
  get maxPlayers() {
    return this.view.max;
  }
  get players() {
    return this.view.players.map((p) => this.toPlayer(p));
  }
  // ── lobby ──────────────────────────────────────────────────────────────────
  setReady(ready) {
    this.mine({ ready: !!ready });
  }
  setPlayerMeta(meta) {
    if (!isObj(meta)) throw new P2PError("invalid-argument", "Player meta must be a plain object.");
    this.mine({ meta: clone(meta) });
  }
  setRoomMeta(meta) {
    this.hostOnly("change the room settings");
    if (!isObj(meta)) throw new P2PError("invalid-argument", "Room meta must be a plain object.");
    const next = mergeMeta(this.st.meta, clone(meta));
    if (jsonSize(next) > MAX_ROOM_META) throw new P2PError("invalid-argument", "Room meta is too large (8 KB max).");
    this.st.meta = next;
    this.commit();
  }
  lock() {
    this.hostOnly("lock the room");
    this.st.locked = true;
    this.commit();
  }
  unlock() {
    this.hostOnly("unlock the room");
    this.st.locked = false;
    this.commit();
  }
  kick(peerId, reason = "") {
    this.hostOnly("remove players");
    if (peerId === this.selfId || !this.st.players.some((p) => p.id === peerId)) return;
    const why = typeof reason === "string" ? reason.slice(0, 200) : "";
    this.kicked.add(peerId);
    this.ctl(peerId, "kick", { reason: why });
    this.removePlayer(peerId, "kicked");
  }
  start(payload) {
    this.hostOnly("start the game");
    encode(["c", "start"], payload);
    const ev = { payload: clone(payload), startAt: this.now() + START_LEAD_MS };
    this.st.started = true;
    this.st.start = ev;
    if (this.lockOnStart) {
      this.st.locked = true;
      for (const id of [...this.pendingJoins.keys()]) {
        this.ctl(id, "reject", { code: "room-locked" });
        this.dropPending(id);
      }
    }
    for (const p of this.st.players) if (p.id !== this.selfId) this.ctl(p.id, "start", ev);
    this.ev.emit("start", clone(ev));
    this.commit();
  }
  // ── messages ───────────────────────────────────────────────────────────────
  send(event, data, opts = {}) {
    this.alive();
    if (typeof event !== "string" || !event || event.length > 64) {
      throw new P2PError("invalid-argument", "Message names must be 1\u201364 characters.");
    }
    if (RESERVED.has(event)) throw new P2PError("invalid-argument", `"${event}" is a room event name; pick another message name.`);
    const reliable = opts.reliable !== false;
    const frame = encode(["m", event, this.now()], data);
    const size = frameSize(frame);
    if (size > (reliable ? MAX_RELIABLE_BYTES : MAX_UNRELIABLE_BYTES)) {
      throw new P2PError(
        "message-too-large",
        `This message is ${Math.ceil(size / 1024)} KB; the limit is ${reliable ? 256 : 16} KB for ${reliable ? "reliable" : "unreliable"} messages.`
      );
    }
    const { peers, self } = this.targets(opts.to ?? "others");
    for (const id of peers) this.links.get(id)?.send(frame, reliable);
    if (self) this.deliverLocal(frame, reliable);
  }
  on(event, cb) {
    const off = this.ev.on(event, cb);
    return off;
  }
  off(event, cb) {
    this.ev.off(event, cb);
  }
  handle(event, handler) {
    if (typeof handler !== "function") throw new P2PError("invalid-argument", "handle() needs a function.");
    this.handlers.set(event, handler);
    return () => {
      if (this.handlers.get(event) === handler) this.handlers.delete(event);
    };
  }
  request(to, event, data, opts = {}) {
    if (this.closed) return Promise.reject(new P2PError("closed", "You're no longer in this room."));
    const target = to === "host" ? this.hostId : to;
    const timeoutMs = Math.max(1, opts.timeoutMs ?? 5e3);
    if (target !== this.selfId && !this.view.players.some((p) => p.id === target)) {
      return Promise.reject(new P2PError("peer-left", "That player isn't in the room."));
    }
    const id = ++this.reqSeq;
    let frame;
    try {
      frame = encode(["q", id, event, this.now()], data);
    } catch (e) {
      return Promise.reject(e);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.reqs.delete(id);
        reject(new P2PError("timeout", `No answer to "${event}" within ${timeoutMs} ms.`));
      }, timeoutMs);
      this.reqs.set(id, { to: target, resolve, reject, timer });
      if (target === this.selfId) queueMicrotask(() => this.onFrame(this.selfId, frame, true));
      else this.links.get(target)?.send(frame, true);
    });
  }
  // ── clock & diagnostics ────────────────────────────────────────────────────
  now() {
    const t = env.now();
    if (this.isHost) return t;
    const v = t + (this.clock.offset() ?? 0);
    if (v < this.lastNow) return this.lastNow;
    this.lastNow = v;
    return v;
  }
  async stats() {
    const out = {};
    for (const p of this.view.players) {
      const link = this.links.get(p.id);
      if (!link) continue;
      const s = await link.stats();
      out[p.id] = { rttMs: this.rtt.get(p.id) ?? s.rttMs, lossPct: this.loss(p.id), bytesIn: s.bytesIn, bytesOut: s.bytesOut, relay: s.relay };
    }
    return out;
  }
  async leave() {
    if (this.closed) return;
    for (const l of this.links.values()) this.sendCtl(l, "bye", this.isHost ? { host: true } : null);
    await new Promise((r) => setTimeout(r, 150));
    this.finish("left", true);
  }
  // ── internals: setup ──────────────────────────────────────────────────────
  /** Host: initial state, then publish. */
  hostInit(sig, opts) {
    this.attach(sig);
    this.lockOnStart = opts.lockOnStart;
    this.st = {
      rev: 0,
      host: this.selfId,
      meta: opts.meta,
      locked: false,
      started: false,
      max: opts.max,
      players: [{ id: this.selfId, ...this.d.self, ready: false, meta: {}, hidden: this.hidden }],
      pending: [],
      start: null
    };
    this.view = clone(this.st);
    this.commit(void 0, true);
    this.startPings();
  }
  /** Joiner: dial the host and wait to be admitted. */
  joinFlow(sig, timeoutMs) {
    this.attach(sig);
    this.phase = "joining";
    this.startPings();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.failJoin(this.classifyJoinFailure()), timeoutMs);
      this.joinWaiter = {
        resolve: (r) => {
          clearTimeout(timer);
          resolve(r);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      };
      this.makeLink(this.hostId, true);
      sig.urgent(timeoutMs);
    });
  }
  /** The room's own answer to a join request (used by the local transport). */
  precheck(version, from) {
    if (this.closed) return { code: "room-not-found" };
    if (this.kicked.has(from)) return { code: "room-locked", reason: "kicked" };
    if (version !== this.d.gameVersion) return { code: "version-mismatch", hostVersion: this.d.gameVersion };
    if (this.st.locked || this.st.started && this.lockOnStart) return { code: "room-locked" };
    if (this.pendingJoins.has(from) || this.st.players.some((p) => p.id === from)) return null;
    if (this.st.players.length + this.pendingJoins.size >= this.st.max) return { code: "room-full" };
    return null;
  }
  attach(sig) {
    this.sig = sig;
    sig.onMessage = (from, data) => this.onSignal(from, data);
    sig.onLost = () => {
      if (this.phase === "joining") this.failJoin(connectFailed("room-closed"));
      else if (this.isHost) this.ev.emit("error", connectFailed("registration-lost"));
    };
  }
  // ── internals: links & routing ─────────────────────────────────────────────
  makeLink(id, initiator) {
    const existing = this.links.get(id);
    if (existing) return existing;
    const link = new PeerLink(id, !initiator, initiator, this.d.rtc(), this.d.simulate, {
      signal: (data) => this.route(id, data),
      frame: (f, reliable) => this.onFrame(id, f, reliable),
      state: (s) => this.onLinkState(link, s),
      track: (e) => this.voice.onTrack(id, e),
      log: this.d.log
    });
    this.links.set(id, link);
    const early = this.early.get(id);
    if (early) {
      this.early.delete(id);
      for (const s of early) link.signal(s);
    }
    return link;
  }
  /** Get a signaling message to `to` by the best path available. */
  route(to, data) {
    if (this.closed) return;
    const direct = this.links.get(to);
    if (direct?.open) return this.sendCtl(direct, "sig", { data });
    const hostLink = this.links.get(this.hostId);
    if (!this.isHost && to !== this.hostId) {
      if (hostLink?.open) return this.sendCtl(hostLink, "relay", { to, data });
      if (!this.sig.anyPair) return;
    }
    this.sig.send(to, data);
  }
  onSignal(from, data) {
    if (this.closed || !isObj(data)) return;
    switch (data.k) {
      case "fwd":
        if (from === this.hostId && typeof data.from === "string") this.onSignal(data.from, data.data);
        return;
      case "join":
        if (this.isHost) this.onJoin(from, data);
        return;
      case "reject":
        if (from === this.hostId && this.phase === "joining") this.failJoin(this.refusal(data));
        return;
      case "rtc":
        return this.onRtc(from, data);
    }
  }
  onRtc(from, s) {
    let link = this.links.get(from);
    if (!link) {
      const allowed = this.isHost ? this.pendingJoins.has(from) : s.d?.type === "offer" && from !== this.hostId;
      if (!allowed) {
        const q = this.early.get(from) ?? [];
        if (q.length < 50) q.push(s);
        this.early.set(from, q);
        setTimeout(() => this.early.delete(from), 1e4);
        return;
      }
      link = this.makeLink(from, false);
    }
    link.signal(s);
  }
  onLinkState(link, s) {
    const id = link.id;
    if (this.links.get(id) !== link) return;
    if (s === "open") {
      this.clearDrop(id);
      this.burstPing(id);
      void this.refreshRelay(id);
      this.voice.linkOpen(link);
      if (!this.isHost && id === this.hostId && this.phase === "joining") {
        this.sendCtl(link, "hello", { name: this.d.self.name, avatarUrl: this.d.self.avatarUrl, v: this.d.gameVersion });
      }
      if (this.isHost) this.maybeWelcome(id);
      this.checkMeshed();
      this.connChanged(id);
    } else if (s === "disrupted") {
      this.connChanged(id);
      this.sig.urgent(DROP_AFTER_MS + 5e3);
      if (this.isHost) this.dropLater(id, () => this.removePlayer(id, "timeout"));
      else if (id === this.hostId) this.dropLater(id, () => this.hostGone("timeout"));
    } else if (s === "connecting") {
      if (link.failed && this.phase === "joining") this.failJoin(this.classifyJoinFailure());
    } else if (s === "closed") {
      this.links.delete(id);
      this.clearDrop(id);
      this.voice.detach(id);
      if (this.closed) return;
      if (this.isHost) {
        if (this.pendingJoins.has(id)) this.dropPending(id);
        else this.removePlayer(id, this.byes.has(id) ? "left" : "disconnected");
      } else if (id === this.hostId) {
        if (this.phase === "joining") this.failJoin(connectFailed("room-closed"));
        else this.hostGone("host-left");
      } else this.connChanged(id);
    }
  }
  dropLater(id, fn) {
    if (this.dropTimers.has(id)) return;
    this.dropTimers.set(
      id,
      setTimeout(() => {
        this.dropTimers.delete(id);
        if (!this.closed && !this.links.get(id)?.open) fn();
      }, DROP_AFTER_MS)
    );
  }
  clearDrop(id) {
    clearTimeout(this.dropTimers.get(id));
    this.dropTimers.delete(id);
  }
  // ── internals: frames ──────────────────────────────────────────────────────
  sendCtl(link, kind, body, reliable = true) {
    try {
      link.send(encode(["c", kind], body), reliable);
    } catch (e) {
      this.d.log("control send failed", kind, e);
    }
  }
  ctl(id, kind, body) {
    const link = this.links.get(id);
    if (link) this.sendCtl(link, kind, body);
  }
  onFrame(from, raw, reliable) {
    if (this.closed) return;
    const msg = decode(raw);
    if (!msg) return;
    const h = msg.header;
    if (h[0] === "c") return this.onControl(from, String(h[1]), msg.body);
    if (this.phase === "joining") {
      if (this.held.length < 1e3) this.held.push(() => this.onUserFrame(from, h, msg.body, reliable));
      return;
    }
    this.onUserFrame(from, h, msg.body, reliable);
  }
  onUserFrame(from, h, body, reliable) {
    if (h[0] === "m") {
      const event = String(h[1]);
      if (RESERVED.has(event)) return;
      this.ev.emit(event, body, { from, sentAt: Number(h[2]), reliable });
    } else if (h[0] === "q") this.onRequest(from, Number(h[1]), String(h[2]), Number(h[3]), body);
    else if (h[0] === "r") {
      const pending = this.reqs.get(Number(h[1]));
      if (!pending || pending.to !== from) return;
      this.reqs.delete(Number(h[1]));
      clearTimeout(pending.timer);
      if (h[2]) pending.resolve(body);
      else pending.reject(new P2PError("handler-error", typeof body === "string" && body ? body : "The request failed."));
    }
  }
  onRequest(from, id, event, sentAt, body) {
    const handler = this.handlers.get(event);
    if (!handler) {
      this.d.log(`request "${event}" from ${from} has no handler (the caller will time out)`);
      return;
    }
    const reply = (ok, value) => {
      let frame;
      try {
        frame = encode(["r", id, ok], value);
      } catch {
        frame = encode(["r", id, false], "The answer could not be sent (not JSON-serialisable).");
      }
      if (from === this.selfId) queueMicrotask(() => this.onFrame(this.selfId, frame, true));
      else this.links.get(from)?.send(frame, true);
    };
    Promise.resolve().then(() => handler(body, { from, sentAt, reliable: true })).then(
      (v) => reply(true, v),
      (e) => reply(false, e instanceof Error ? e.message : String(e ?? "The request failed."))
    );
  }
  deliverLocal(frame, reliable) {
    const msg = decode(frame);
    if (msg) this.ev.emit(String(msg.header[1]), msg.body, { from: this.selfId, sentAt: Number(msg.header[2]), reliable });
  }
  targets(to) {
    const others = this.view.players.map((p) => p.id).filter((id) => id !== this.selfId);
    if (to === "others") return { peers: others, self: false };
    if (to === "all") return { peers: others, self: true };
    const list2 = to === "host" ? [this.hostId] : Array.isArray(to) ? to : [to];
    return { peers: list2.filter((id) => id !== this.selfId), self: list2.includes(this.selfId) };
  }
  // ── internals: control messages ────────────────────────────────────────────
  onControl(from, kind, body) {
    const fromHost = from === this.hostId;
    switch (kind) {
      case "ping": {
        const link = this.links.get(from);
        if (link) this.sendCtl(link, "pong", [body, env.now()], false);
        return;
      }
      case "pong":
        return this.onPong(from, body);
      case "sig": {
        if (!isObj(body)) return;
        const origin = fromHost && typeof body.from === "string" ? body.from : from;
        return this.onSignal(origin, body.data);
      }
      case "relay": {
        if (!this.isHost || !isObj(body) || typeof body.to !== "string") return;
        const target = body.to;
        if (!this.pendingJoins.has(target) && !this.st.players.some((p) => p.id === target)) return;
        const link = this.links.get(target);
        if (link?.open) this.sendCtl(link, "sig", { from, data: body.data });
        else {
          this.sig.send(target, { k: "fwd", from, data: body.data });
          this.sig.urgent();
        }
        return;
      }
      case "hello": {
        const p = this.pendingJoins.get(from);
        if (!this.isHost || !p || !isObj(body)) return;
        p.name = sanitizeName(body.name, p.name);
        p.avatarUrl = safeAvatar(body.avatarUrl);
        p.hello = true;
        return this.maybeWelcome(from);
      }
      case "welcome":
        if (fromHost && this.phase === "joining" && isObj(body)) return this.onWelcome(body);
        return;
      case "meshed":
        if (this.isHost) this.admit(from);
        return;
      case "snap":
        if (fromHost && isObj(body)) this.applySnap(body);
        return;
      case "set":
        if (this.isHost && isObj(body)) this.onSet(from, body);
        return;
      case "start":
        if (fromHost && this.phase === "joined") this.ev.emit("start", body);
        return;
      case "kick":
        if (fromHost && !this.isHost) {
          this.ev.emit("kicked", { reason: isObj(body) && typeof body.reason === "string" ? body.reason : "" });
          this.finish("kicked", false);
        }
        return;
      case "reject":
        if (fromHost && this.phase === "joining") this.failJoin(this.refusal(body));
        return;
      case "bye":
        this.byes.add(from);
        if (fromHost && !this.isHost) this.hostGone("host-left");
        else if (this.isHost) {
          if (this.pendingJoins.has(from)) this.dropPending(from);
          else this.removePlayer(from, "left");
        }
        return;
      case "vis": {
        const hidden = body === true;
        for (const s of this.isHost ? [this.st, this.view] : [this.view]) {
          const p = s.players.find((x) => x.id === from);
          if (p) p.hidden = hidden;
        }
        if (this.phase === "joined") this.ev.emit("visibility", { id: from, hidden });
        return;
      }
      case "voice":
        return this.voice.remoteFlag(from, body === true);
    }
  }
  // ── internals: host side ───────────────────────────────────────────────────
  onJoin(from, data) {
    if (this.st.players.some((p) => p.id === from) || this.pendingJoins.has(from)) return;
    const refusal = this.precheck(typeof data.v === "string" ? data.v : "", from);
    if (refusal) {
      this.sig.send(from, { k: "reject", ...refusal });
      return;
    }
    this.pendingJoins.set(from, {
      name: sanitizeName(data.name),
      avatarUrl: null,
      hello: false,
      welcomed: false,
      timer: setTimeout(() => {
        if (this.pendingJoins.has(from)) {
          this.d.log("join timed out", from);
          this.dropPending(from);
        }
      }, PENDING_TIMEOUT_MS)
    });
    this.makeLink(from, false);
    this.sig.urgent();
    this.commit();
  }
  maybeWelcome(id) {
    const p = this.pendingJoins.get(id);
    const link = this.links.get(id);
    if (!p || p.welcomed || !p.hello || !link?.open) return;
    p.welcomed = true;
    const dial = [...this.st.players.map((x) => x.id), ...this.pendingJoins.keys()].filter(
      (x) => x !== id && x !== this.selfId
    );
    this.sendCtl(link, "welcome", { snap: this.snapshot(), dial });
  }
  admit(id) {
    const p = this.pendingJoins.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingJoins.delete(id);
    if (this.st.players.length >= this.st.max) {
      this.ctl(id, "reject", { code: "room-full" });
      this.links.get(id)?.closeSoon();
      this.commit();
      return;
    }
    this.st.players.push({ id, name: p.name, avatarUrl: p.avatarUrl, ready: false, meta: {}, hidden: false });
    this.commit();
  }
  dropPending(id) {
    const p = this.pendingJoins.get(id);
    if (!p) return;
    clearTimeout(p.timer);
    this.pendingJoins.delete(id);
    this.links.get(id)?.closeSoon();
    this.commit();
  }
  removePlayer(id, reason) {
    const i = this.st.players.findIndex((p) => p.id === id);
    if (i >= 0) {
      this.st.players.splice(i, 1);
      this.commit([[id, reason]]);
    }
    const link = this.links.get(id);
    if (link && reason === "kicked") link.closeSoon();
    else link?.close();
  }
  onSet(from, body) {
    const p = this.st.players.find((x) => x.id === from);
    if (!p) return;
    if (typeof body.ready === "boolean") p.ready = body.ready;
    if (isObj(body.meta)) {
      const next = mergeMeta(p.meta, body.meta);
      if (jsonSize(next) <= MAX_PLAYER_META) p.meta = next;
    }
    this.commit();
  }
  snapshot(left) {
    const s = clone(this.st);
    s.host = this.selfId;
    s.pending = [...this.pendingJoins.keys()];
    if (left) s.left = left;
    return s;
  }
  /** Host: publish the current state to everyone, and apply it locally. */
  commit(left, silent = false) {
    if (!this.isHost || this.closed) return;
    this.st.rev++;
    const snap = this.snapshot(left);
    this.applySnap(snap, silent);
    for (const link of this.links.values()) if (link.open) this.sendCtl(link, "snap", snap);
    const full = this.st.players.length + this.pendingJoins.size >= this.st.max;
    const locked = this.st.locked || this.st.started && this.lockOnStart;
    this.sig?.setLobby({ joinable: !locked && !full, locked, full });
  }
  // ── internals: every peer ──────────────────────────────────────────────────
  /** Optimistically apply my own ready/meta change, and tell the host. */
  mine(change) {
    this.alive();
    const me = (this.isHost ? this.st : this.view).players.find((p) => p.id === this.selfId);
    if (!me) return;
    const meta = change.meta ? mergeMeta(me.meta, change.meta) : me.meta;
    if (jsonSize(meta) > MAX_PLAYER_META) throw new P2PError("invalid-argument", "Player meta is too large (4 KB max).");
    if (this.isHost) {
      if (change.ready !== void 0) me.ready = change.ready;
      me.meta = meta;
      this.commit();
      return;
    }
    if (change.ready !== void 0) me.ready = change.ready;
    me.meta = meta;
    this.ev.emit("player-update", this.toPlayer(me));
    this.ctl(this.hostId, "set", change);
  }
  applySnap(snap, silent = this.phase === "joining") {
    if (!Array.isArray(snap.players)) return;
    if (!this.isHost && snap.rev <= this.view.rev && this.phase === "joined") return;
    const prev = this.view;
    this.view = snap;
    this.hostId = snap.host;
    const ids = new Set(snap.players.map((p) => p.id));
    const keep = /* @__PURE__ */ new Set([...ids, ...snap.pending ?? [], snap.host]);
    for (const [id, link] of this.links) if (!keep.has(id)) link.close();
    for (const [id, r] of this.reqs) {
      if (r.to !== this.selfId && !ids.has(r.to)) {
        this.reqs.delete(id);
        clearTimeout(r.timer);
        r.reject(new P2PError("peer-left", "That player left before answering."));
      }
    }
    if (!this.isHost && this.phase === "joining") {
      if (ids.has(this.selfId)) return this.joined();
      return this.checkMeshed();
    }
    if (!this.isHost && !ids.has(this.selfId)) {
      const why = snap.left?.find(([id]) => id === this.selfId)?.[1];
      if (why === "kicked") this.ev.emit("kicked", { reason: "" });
      return this.finish(why === "kicked" ? "kicked" : "timeout", false);
    }
    if (silent) return;
    const before = new Map(prev.players.map((p) => [p.id, p]));
    const left = new Map(snap.left ?? []);
    for (const p of snap.players) {
      const old = before.get(p.id);
      if (!old) {
        if (p.id !== this.selfId) this.ev.emit("player-join", this.toPlayer(p));
      } else if (old.ready !== p.ready || old.name !== p.name || old.avatarUrl !== p.avatarUrl || JSON.stringify(old.meta) !== JSON.stringify(p.meta)) {
        this.ev.emit("player-update", this.toPlayer(p));
      }
    }
    for (const id of before.keys()) {
      if (!ids.has(id)) this.ev.emit("player-leave", { id, reason: left.get(id) ?? "left" });
    }
    if (prev.locked !== snap.locked || prev.started !== snap.started || prev.max !== snap.max || JSON.stringify(prev.meta) !== JSON.stringify(snap.meta)) {
      this.ev.emit("room-update", this);
    }
  }
  onWelcome({ snap, dial }) {
    if (this.welcomed) return;
    this.applySnap(snap, true);
    for (const id of Array.isArray(dial) ? dial : []) {
      if (typeof id !== "string" || id === this.selfId || id === this.hostId) continue;
      this.dial.add(id);
      this.makeLink(id, true);
    }
    this.welcomed = true;
    this.checkMeshed();
  }
  checkMeshed() {
    if (this.isHost || this.phase !== "joining" || !this.welcomed || this.meshedSent) return;
    const present = /* @__PURE__ */ new Set([...this.view.players.map((p) => p.id), ...this.view.pending ?? []]);
    for (const id of [...this.dial]) {
      if (!present.has(id)) {
        this.dial.delete(id);
        continue;
      }
      if (!this.links.get(id)?.open) return;
    }
    const host = this.links.get(this.hostId);
    if (!host?.open) return;
    this.meshedSent = true;
    this.sendCtl(host, "meshed", null);
  }
  joined() {
    this.phase = "joined";
    const waiter = this.joinWaiter;
    this.joinWaiter = void 0;
    waiter?.resolve(this);
    setTimeout(() => {
      if (this.closed) return;
      if (this.view.started && this.view.start) this.ev.emit("start", clone(this.view.start));
      for (const f of this.held.splice(0)) f();
    }, 0);
  }
  failJoin(err) {
    if (this.phase !== "joining" || this.closed) return;
    const waiter = this.joinWaiter;
    this.joinWaiter = void 0;
    for (const l of this.links.values()) this.sendCtl(l, "bye", null);
    this.finish("error", true, true);
    waiter?.reject(err);
  }
  classifyJoinFailure() {
    const host = this.links.get(this.hostId);
    if (!host || !host.negotiated && !host.failed) return roomError("timeout");
    if (!host.open) {
      if (this.d.relayOnly) return connectFailed(this.d.turn ? "turn-failed" : "relay-unavailable");
      return connectFailed(this.d.turn ? "turn-failed" : "no-turn-restrictive-network");
    }
    return connectFailed("peer-unreachable");
  }
  hostGone(reason) {
    if (this.closed || this.isHost) return;
    if (this.phase === "joining") return this.failJoin(connectFailed("room-closed"));
    this.ev.emit("host-left");
    this.finish(reason, false);
  }
  /** Tear everything down. `silentClose` skips the `closed` event (a failed join rejects instead). */
  finish(reason, byeToServer, silentClose = false) {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.pingTimer);
    for (const t of this.dropTimers.values()) clearTimeout(t);
    for (const p of this.pendingJoins.values()) clearTimeout(p.timer);
    for (const [, r] of this.reqs) {
      clearTimeout(r.timer);
      r.reject(new P2PError("closed", "You're no longer in this room."));
    }
    this.reqs.clear();
    this.voice.shutdown();
    for (const link of [...this.links.values()]) link.closeSoon(300);
    this.sig?.close(byeToServer || this.isHost);
    for (const u of this.unlisten) u();
    const waiter = this.joinWaiter;
    this.joinWaiter = void 0;
    waiter?.reject(connectFailed("room-closed"));
    if (!silentClose) this.ev.emit("closed", { reason });
    this.d.onClosed();
  }
  pageGone() {
    if (this.closed) return;
    for (const l of this.links.values()) this.sendCtl(l, "bye", this.isHost ? { host: true } : null);
    this.finish("left", true);
  }
  setHidden(hidden) {
    if (this.closed || hidden === this.hidden) return;
    this.hidden = hidden;
    for (const s of this.isHost ? [this.st, this.view] : [this.view]) {
      const me = s.players.find((p) => p.id === this.selfId);
      if (me) me.hidden = hidden;
    }
    for (const l of this.links.values()) if (l.open) this.sendCtl(l, "vis", hidden);
  }
  // ── internals: ping, clock, connection info ────────────────────────────────
  startPings() {
    let n = 0;
    this.pingTimer = setInterval(() => {
      n++;
      for (const link of this.links.values()) {
        if (!link.open) continue;
        this.ping(link);
        if (n % 3 === 0) void this.refreshRelay(link.id);
      }
    }, PING_EVERY_MS);
  }
  burstPing(id) {
    for (let i = 0; i < 6; i++) {
      setTimeout(() => {
        const link = this.links.get(id);
        if (link?.open) this.ping(link);
      }, i * 120);
    }
  }
  ping(link) {
    const t0 = env.now();
    const log = this.pings.get(link.id) ?? [];
    log.push({ t0, ok: false });
    if (log.length > 30) log.shift();
    this.pings.set(link.id, log);
    this.sendCtl(link, "ping", t0, false);
  }
  onPong(from, body) {
    if (!Array.isArray(body)) return;
    const [t0, remote] = body;
    const t1 = env.now();
    const entry = this.pings.get(from)?.find((p) => p.t0 === t0);
    if (!entry || entry.ok) return;
    entry.ok = true;
    const rtt = t1 - t0;
    this.rtt.set(from, smooth(this.rtt.get(from) ?? null, rtt));
    if (from === this.hostId && !this.isHost) this.clock.add(t0, remote, t1);
  }
  loss(id) {
    const cutoff = env.now() - 3e3;
    const settled = (this.pings.get(id) ?? []).filter((p) => p.t0 < cutoff).slice(-20);
    if (!settled.length) return null;
    return Math.round(100 * settled.filter((p) => !p.ok).length / settled.length);
  }
  async refreshRelay(id) {
    const link = this.links.get(id);
    if (!link) return;
    const before = link.relay;
    await link.stats();
    if (link.relay !== before) this.connChanged(id);
  }
  connChanged(id) {
    if (this.phase !== "joined") return;
    const p = this.view.players.find((x) => x.id === id);
    if (p) this.ev.emit("player-update", this.toPlayer(p));
  }
  conn(id) {
    if (id === this.selfId) return { state: "connected", rttMs: 0, relay: false };
    const link = this.links.get(id);
    const state = link?.open ? "connected" : link?.state === "disrupted" ? "reconnecting" : "connecting";
    const rtt = this.rtt.get(id);
    return { state, rttMs: rtt == null ? null : Math.round(rtt), relay: link?.relay ?? false };
  }
  toPlayer(p) {
    return {
      id: p.id,
      name: p.name,
      avatarUrl: safeAvatar(p.avatarUrl),
      isHost: p.id === this.hostId,
      isSelf: p.id === this.selfId,
      ready: p.ready,
      meta: clone(p.meta),
      connection: this.conn(p.id),
      hidden: p.hidden
    };
  }
  refusal(r) {
    return roomError(r?.code ?? "room-not-found", {
      code: this.code,
      hostVersion: r?.hostVersion,
      mine: this.d.gameVersion,
      reason: r?.reason
    });
  }
  // ── internals: guards ──────────────────────────────────────────────────────
  hostOnly(what) {
    this.alive();
    if (!this.isHost) throw new P2PError("not-host", `Only the host can ${what}.`);
  }
  alive() {
    if (this.closed) throw new P2PError("closed", "You're no longer in this room.");
  }
  /** For the voice module. */
  forEachOpenLink(fn) {
    for (const l of this.links.values()) if (l.state !== "closed") fn(l);
  }
  control(link, kind, body) {
    this.sendCtl(link, kind, body);
  }
  reportError(err) {
    this.ev.emit("error", err);
  }
};
function safeAvatar(url) {
  if (typeof url !== "string" || url.length > 500) return null;
  try {
    const u = new URL(url);
    let own = "";
    try {
      own = location.host;
    } catch {
    }
    return u.protocol === "https:" && (u.host === own || u.host === "lh3.googleusercontent.com") ? url : null;
  } catch {
    return null;
  }
}
function mergeMeta(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === void 0) delete out[k];
    else out[k] = v;
  }
  return out;
}
function clampPlayers(n) {
  const v = Math.floor(Number(n));
  return Number.isFinite(v) ? Math.min(MAX_PLAYERS, Math.max(1, v)) : 4;
}

// sdk/p2p/src/signaling.ts
var noop = () => {
};
var LocalSignaling = class {
  constructor(bc, code, selfId, precheck) {
    this.bc = bc;
    this.code = code;
    this.selfId = selfId;
    this.precheck = precheck;
    this.anyPair = true;
    this.onMessage = noop;
    this.onLost = noop;
    bc.onmessage = (e) => this.receive(e.data);
  }
  post(m) {
    try {
      this.bc.postMessage(m);
    } catch {
    }
  }
  receive(m) {
    if (!m || m.code !== this.code) return;
    if (m.t === "probe" && this.precheck) this.post({ t: "taken", code: this.code });
    else if (m.t === "join" && this.precheck && m.from) {
      const refusal = this.precheck(m.v ?? "", m.from);
      this.post({ t: "ack", code: this.code, to: m.from, ok: !refusal, err: refusal ?? void 0, hostId: this.selfId });
      if (!refusal) this.onMessage(m.from, { k: "join", name: m.name, v: m.v });
    } else if (m.t === "ack" && m.to === this.selfId) this.ack?.(m);
    else if (m.t === "sig" && m.to === this.selfId && m.from) this.onMessage(m.from, m.data);
  }
  send(to, data) {
    this.post({ t: "sig", code: this.code, to, from: this.selfId, data });
  }
  joinRequest(info) {
    this.post({ t: "join", code: this.code, from: this.selfId, name: info.name, v: info.gameVersion });
  }
  urgent() {
  }
  setLobby() {
  }
  close() {
    this.bc.close();
  }
};
function channel(gameId) {
  if (typeof BroadcastChannel === "undefined") {
    throw new P2PError("unsupported", "This browser can't run the local test transport (no BroadcastChannel).");
  }
  return new BroadcastChannel("hallpass-p2p/" + gameId);
}
function localTransport() {
  return {
    kind: "local",
    async create(info) {
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = generateCode();
        const bc = channel(info.gameId);
        let taken = false;
        bc.onmessage = (e) => {
          const m = e.data;
          if (m?.t === "taken" && m.code === code) taken = true;
        };
        bc.postMessage({ t: "probe", code });
        await new Promise((r) => setTimeout(r, 120));
        if (taken) {
          bc.close();
          continue;
        }
        return { sig: new LocalSignaling(bc, code, info.selfId, info.precheck), code, relayOnly: false };
      }
      throw connectFailed("signaling-unavailable");
    },
    async join(code, info) {
      const bc = channel(info.gameId);
      const sig = new LocalSignaling(bc, code, info.selfId, null);
      const ack = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), 1500);
        sig.ack = (m) => {
          clearTimeout(timer);
          resolve(m);
        };
        sig.joinRequest(info);
      });
      sig.ack = void 0;
      if (!ack) {
        sig.close();
        throw roomError("room-not-found", { code });
      }
      if (!ack.ok || !ack.hostId) {
        sig.close();
        const err = ack.err ?? { code: "room-not-found" };
        throw roomError(err.code, { code, hostVersion: err.hostVersion, mine: info.gameVersion, reason: err.reason });
      }
      return { sig, hostId: ack.hostId, relayOnly: false };
    }
  };
}
async function call(url, body, keepalive = false) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => ctl?.abort(), 1e4);
  try {
    const res = await fetch(url, {
      method: body === void 0 ? "GET" : "POST",
      headers: body === void 0 ? { Accept: "application/json" } : { "Content-Type": "application/json" },
      body: body === void 0 ? void 0 : JSON.stringify(body),
      credentials: "same-origin",
      cache: "no-store",
      ...keepalive ? { keepalive: true } : {},
      signal: ctl?.signal
    });
    let data;
    try {
      data = await res.json();
    } catch {
      data = void 0;
    }
    return { status: res.status, data };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}
var FAST_MS = 250;
var LOBBY_MS = 1e3;
var HEARTBEAT_MS = 25e3;
var BATCH_MS = 30;
var MAX_BATCH = 32;
var HttpSignaling = class {
  constructor(url, token, isHost, log) {
    this.url = url;
    this.token = token;
    this.isHost = isHost;
    this.log = log;
    this.anyPair = false;
    this.onMessage = noop;
    this.onLost = noop;
    this.out = [];
    this.after = 0;
    this.closed = false;
    this.urgentUntil = 0;
    this.lobby = { joinable: true, locked: false, full: false };
    this.backoff = 0;
    void this.loop();
  }
  send(to, data) {
    if (this.closed) return;
    this.out.push({ to, data });
    this.urgent();
  }
  urgent(ms = 15e3) {
    this.urgentUntil = Math.max(this.urgentUntil, env.now() + ms);
    this.wake(BATCH_MS);
  }
  setLobby(s) {
    const changed = s.joinable !== this.lobby.joinable || s.locked !== this.lobby.locked || s.full !== this.lobby.full;
    this.lobby = s;
    if (changed) this.urgent(5e3);
  }
  close(bye) {
    if (this.closed) return;
    this.closed = true;
    this.wakeFn?.();
    if (bye && this.isHost) void call(this.url, { token: this.token, bye: true }, true);
  }
  interval() {
    if (this.out.length) return BATCH_MS;
    if (env.now() < this.urgentUntil) return FAST_MS;
    if (this.isHost) return this.lobby.joinable ? LOBBY_MS : HEARTBEAT_MS;
    return Infinity;
  }
  sleep(ms) {
    return new Promise((resolve) => {
      let timer;
      const done = () => {
        clearTimeout(timer);
        if (this.wakeFn === done) this.wakeFn = void 0;
        resolve();
      };
      if (ms !== Infinity) timer = setTimeout(done, ms);
      this.wakeFn = done;
    });
  }
  wake(delay) {
    const fn = this.wakeFn;
    if (!fn) return;
    if (delay <= 0) fn();
    else setTimeout(() => this.wakeFn === fn && fn(), delay);
  }
  async loop() {
    while (!this.closed) {
      await this.tick();
      if (this.closed) break;
      await this.sleep(this.backoff || this.interval());
    }
  }
  async tick() {
    const batch = this.out.splice(0, MAX_BATCH);
    const r = await call(this.url, {
      token: this.token,
      after: this.after,
      send: batch,
      state: this.isHost ? { locked: this.lobby.locked, full: this.lobby.full } : void 0
    });
    if (this.closed) return;
    const d = r.data;
    if (r.status === 200 && d?.ok) {
      this.backoff = 0;
      const messages = Array.isArray(d.messages) ? d.messages : [];
      for (const m of messages) {
        if (!(m.id > this.after)) continue;
        this.after = m.id;
        try {
          this.onMessage(m.from, m.data);
        } catch (e) {
          this.log("signal handler failed", e);
        }
      }
      if (messages.length) this.urgent(5e3);
      if (d.alive === false) {
        this.closed = true;
        this.onLost();
      }
    } else if (r.status === 401) {
      this.closed = true;
      this.onLost();
    } else if (r.status >= 400 && r.status < 500 && r.status !== 429) {
      this.log("signal batch refused", r.status, d?.error);
    } else {
      this.out.unshift(...batch);
      this.backoff = Math.min(8e3, Math.max(500, this.backoff * 2));
    }
  }
};
function httpFailure(r) {
  if (r.status === 429) return connectFailed("rate-limited");
  if (r.status === 503) return connectFailed("signaling-unavailable");
  return connectFailed("signaling-unreachable");
}
function httpTransport(api, log) {
  const base = api.replace(/\/+$/, "") + "/api/v1/p2p/rooms";
  return {
    kind: "hallpass",
    async create(info) {
      const r = await call(base, {
        gameId: info.gameId,
        gameVersion: info.gameVersion,
        secret: info.secret,
        relayOnly: info.relayOnly
      });
      const d = r.data;
      if (r.status === 404) throw connectFailed("unknown-game");
      if (r.status !== 200 || !d?.ok || typeof d.code !== "string" || typeof d.token !== "string") throw httpFailure(r);
      if (d.peerId !== info.selfId) throw connectFailed("signaling-unavailable");
      const sig = new HttpSignaling(`${base}/${d.code}/signal`, d.token, true, log);
      return { sig, code: d.code, relayOnly: d.relayOnly === true };
    },
    async join(code, info) {
      const r = await call(`${base}/${encodeURIComponent(code)}/join`, {
        gameId: info.gameId,
        gameVersion: info.gameVersion,
        secret: info.secret,
        name: info.name
      });
      const d = r.data;
      if (r.status === 404) throw roomError("room-not-found", { code });
      if (r.status === 409 && typeof d?.error === "string") {
        throw roomError(d.error, {
          code,
          hostVersion: typeof d.hostVersion === "string" ? d.hostVersion : void 0,
          mine: info.gameVersion
        });
      }
      if (r.status !== 200 || !d?.ok || typeof d.token !== "string" || typeof d.hostId !== "string") throw httpFailure(r);
      if (d.peerId !== info.selfId) throw connectFailed("signaling-unavailable");
      const sig = new HttpSignaling(`${base}/${code}/signal`, d.token, false, log);
      sig.urgent(3e4);
      return { sig, hostId: d.hostId, relayOnly: d.relayOnly === true };
    }
  };
}
async function fetchConfig(api, gameId) {
  const r = await call(`${api.replace(/\/+$/, "")}/api/v1/p2p/config?game=${encodeURIComponent(gameId)}`);
  const d = r.data;
  if (r.status !== 200 || !d?.ok || !Array.isArray(d.iceServers)) return null;
  const self = d.self;
  return {
    self: self && typeof self.name === "string" ? { name: self.name, avatarUrl: self.avatarUrl ?? null } : null,
    iceServers: d.iceServers,
    iceExpiresAt: typeof d.iceExpiresAt === "number" ? d.iceExpiresAt : null,
    turn: d.turn === true,
    forceRelay: d.forceRelay === true
  };
}

// sdk/p2p/src/version.ts
var P2P_VERSION = "1.0.0";

// sdk/p2p/src/client.ts
var LOCAL_HOSTS = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
var PUBLIC_STUN = [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
function pageOrigin() {
  try {
    return location.origin;
  } catch {
    return "";
  }
}
function defaultApi() {
  try {
    const api = globalThis.HALLPASS_CONFIG?.api;
    if (typeof api === "string" && api) return api;
  } catch {
  }
  return pageOrigin();
}
function autoTransport() {
  try {
    return LOCAL_HOSTS.has(location.hostname) ? "local" : "hallpass";
  } catch {
    return "local";
  }
}
function randomId() {
  const a = "abcdefghijklmnopqrstuvwxyz234567";
  const buf = new Uint8Array(12);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => a[b & 31]).join("");
}
async function connect(opts) {
  if (!opts || !isValidGameId(opts.gameId)) {
    throw new P2PError("invalid-argument", 'connect() needs a gameId made of lowercase letters, digits and dashes, like "last-bell".');
  }
  if (!env.RTCPeerConnection) {
    throw new P2PError("unsupported", "This browser doesn't support peer-to-peer connections (WebRTC).");
  }
  const log = opts.debug ? (...a) => console.log("[hallpass-p2p]", ...a) : () => {
  };
  const kind = opts.transport && opts.transport !== "auto" ? opts.transport : autoTransport();
  const api = (opts.api || defaultApi()).replace(/\/+$/, "");
  const secret = generateSecret();
  const id = kind === "local" && !globalThis.crypto?.subtle ? randomId() : await derivePeerId(secret);
  const cfg = kind === "hallpass" ? await fetchConfig(api, opts.gameId) : null;
  if (kind === "hallpass" && !cfg) log("HallPass config unavailable; using the fallback name and public STUN");
  if (kind !== "local" && opts.simulate) log("simulate only applies to the local transport; ignored");
  const self = {
    id,
    name: cfg?.self?.name ?? sanitizeName(opts.name, "Player"),
    avatarUrl: cfg?.self?.avatarUrl ?? null
  };
  log("connected", { transport: kind, id, turn: cfg?.turn ?? false });
  return new ClientImpl(opts, kind, api, secret, self, log, cfg);
}
var ClientImpl = class {
  constructor(opts, transport, api, secret, self, log, cfg) {
    this.opts = opts;
    this.transport = transport;
    this.api = api;
    this.secret = secret;
    this.self = self;
    this.log = log;
    this.room = null;
    this.busy = false;
    this.closed = false;
    this.t = transport === "local" ? localTransport() : httpTransport(api, log);
    this.ice = {
      // The local transport uses NO ICE servers, so it works offline and talks
      // to nothing outside the machine: tabs connect over host candidates.
      // (Safari hides host candidates from pages without mic/camera
      // permission — see the README's Safari note.)
      servers: opts.iceServers ?? (transport === "local" ? [] : cfg?.iceServers ?? PUBLIC_STUN),
      expiresAt: cfg?.iceExpiresAt ?? null,
      turn: cfg?.turn ?? false,
      forceRelay: cfg?.forceRelay ?? false
    };
    this.scheduleRefresh();
  }
  async createRoom(opts = {}) {
    this.guard();
    const meta = opts.meta ?? {};
    if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
      throw new P2PError("invalid-argument", "Room meta must be a plain object.");
    }
    if (JSON.stringify(meta).length > 8192) throw new P2PError("invalid-argument", "Room meta is too large (8 KB max).");
    const relayOnly = this.needRelay(false);
    this.busy = true;
    try {
      const gameVersion = sanitizeVersion(this.opts.gameVersion);
      let room = null;
      const { sig, code } = await this.t.create({
        gameId: this.opts.gameId,
        gameVersion,
        relayOnly,
        selfId: this.self.id,
        secret: this.secret,
        precheck: (v, from) => room ? room.precheck(v, from) : { code: "room-not-found" }
      });
      room = this.newRoom(code, this.self.id, true, relayOnly);
      room.hostInit(sig, { max: clampPlayers(opts.maxPlayers ?? 4), meta: JSON.parse(JSON.stringify(meta)), lockOnStart: !!opts.lockOnStart });
      this.log("room created", code);
      return room;
    } finally {
      this.busy = false;
    }
  }
  async joinRoom(code, opts = {}) {
    this.guard();
    const c = normalizeCode(code);
    if (!c) throw new P2PError("room-not-found", "Room codes are 4 letters or numbers, like K7QX.");
    this.needRelay(false);
    this.busy = true;
    try {
      const { sig, hostId, relayOnly: roomRelay } = await this.t.join(c, {
        gameId: this.opts.gameId,
        gameVersion: sanitizeVersion(this.opts.gameVersion),
        selfId: this.self.id,
        secret: this.secret,
        name: this.self.name
      });
      let relayOnly;
      try {
        relayOnly = this.needRelay(roomRelay);
      } catch (e) {
        sig.close(false);
        throw e;
      }
      const room = this.newRoom(c, hostId, false, relayOnly);
      try {
        return await room.joinFlow(sig, Math.max(1e3, opts.timeoutMs ?? 2e4));
      } catch (e) {
        if (this.room === room) this.room = null;
        throw e;
      }
    } finally {
      this.busy = false;
    }
  }
  async close() {
    if (this.closed) return;
    await this.room?.leave();
    this.closed = true;
    clearTimeout(this.refreshTimer);
  }
  newRoom(code, hostId, isHost, relayOnly) {
    const room = new RoomImpl({
      code,
      selfId: this.self.id,
      hostId,
      isHost,
      self: { name: this.self.name, avatarUrl: this.self.avatarUrl },
      gameVersion: sanitizeVersion(this.opts.gameVersion),
      rtc: () => ({ iceServers: this.ice.servers, iceTransportPolicy: relayOnly ? "relay" : "all" }),
      simulate: this.transport === "local" ? this.opts.simulate ?? null : null,
      log: this.log,
      onClosed: () => {
        if (this.room === room) this.room = null;
      },
      turn: this.ice.turn,
      relayOnly
    });
    this.room = room;
    return room;
  }
  /** Whether this connection must be relay-only; throws when that cannot work. */
  needRelay(roomRelay) {
    if (this.transport === "local") return false;
    const relay = !!this.opts.relayOnly || this.ice.forceRelay || roomRelay;
    if (relay && !this.ice.turn) throw connectFailed("relay-unavailable");
    return relay;
  }
  guard() {
    if (this.closed) throw new P2PError("closed", "This connection was closed. Call HallPassP2P.connect() again.");
    if (this.busy || this.room && !this.room.closed) {
      throw new P2PError("already-in-room", "You're already in a room. Leave it before creating or joining another.");
    }
  }
  /** Fetch fresh TURN credentials ten minutes before the current ones expire. */
  scheduleRefresh() {
    clearTimeout(this.refreshTimer);
    const exp = this.ice.expiresAt;
    if (this.transport !== "hallpass" || !exp || this.opts.iceServers) return;
    const wait = Math.max(6e4, exp - Date.now() - 10 * 6e4);
    this.refreshTimer = setTimeout(async () => {
      if (this.closed) return;
      const cfg = await fetchConfig(this.api, this.opts.gameId);
      if (cfg) {
        this.ice = { servers: cfg.iceServers, expiresAt: cfg.iceExpiresAt, turn: cfg.turn, forceRelay: cfg.forceRelay };
        for (const link of this.room?.links.values() ?? []) {
          try {
            link.pc.setConfiguration({ ...link.pc.getConfiguration(), iceServers: cfg.iceServers });
          } catch (e) {
            this.log("ICE refresh failed", e);
          }
        }
      }
      this.scheduleRefresh();
    }, wait);
  }
};

// sdk/p2p/src/selftest.ts
var list = (u) => Array.isArray(u) ? u : u ? [u] : [];
function parse(c) {
  const s = c.candidate || "";
  const type = c.type ?? /\btyp (\w+)/.exec(s)?.[1];
  if (!type) return null;
  const parts = s.split(" ");
  return {
    type,
    address: c.address ?? parts[4] ?? "",
    port: c.port ?? Number(parts[5]),
    relatedPort: c.relatedPort ?? Number(/\brport (\d+)/.exec(s)?.[1] ?? 0)
  };
}
function gather(config, timeoutMs) {
  const PC = env.RTCPeerConnection;
  const out = [];
  return new Promise((resolve) => {
    let pc;
    try {
      pc = new PC(config);
    } catch {
      resolve(out);
      return;
    }
    const done = () => {
      clearTimeout(timer);
      try {
        pc.close();
      } catch {
      }
      resolve(out);
    };
    const timer = setTimeout(done, timeoutMs);
    pc.onicecandidate = (e) => {
      if (!e.candidate) return done();
      const c = parse(e.candidate);
      if (c) out.push(c);
    };
    pc.createDataChannel("probe");
    pc.createOffer().then((o) => pc.setLocalDescription(o)).catch(done);
  });
}
async function selfTest(opts = {}) {
  const notes = [];
  if (!env.RTCPeerConnection) {
    return { stun: false, turn: false, natType: "unknown", notes: ["This browser doesn't support WebRTC, so peer-to-peer play won't work here."] };
  }
  let servers = opts.iceServers;
  if (!servers) {
    const cfg = await fetchConfig((opts.api || defaultApi()).replace(/\/+$/, ""), opts.gameId || DEMO_GAME_ID);
    if (!cfg) notes.push("Couldn't reach HallPass for relay settings, so only direct connections were tested.");
    servers = cfg?.iceServers ?? [{ urls: ["stun:stun.cloudflare.com:3478", "stun:stun.l.google.com:19302"] }];
  }
  const stunServers = servers.map((s) => ({ urls: list(s.urls).filter((u) => u.startsWith("stun:")) })).filter((s) => s.urls.length);
  const turnServers = servers.map((s) => ({ ...s, urls: list(s.urls).filter((u) => /^turns?:/.test(u)) })).filter((s) => s.urls.length && s.username);
  const timeout = opts.timeoutMs ?? 5e3;
  const [direct, relayed] = await Promise.all([
    stunServers.length ? gather({ iceServers: stunServers }, timeout) : Promise.resolve([]),
    turnServers.length ? gather({ iceServers: turnServers, iceTransportPolicy: "relay" }, timeout) : Promise.resolve([])
  ]);
  const srflx = direct.filter((c) => c.type === "srflx");
  const stun = srflx.length > 0;
  const turn = relayed.some((c) => c.type === "relay");
  let natType = "unknown";
  if (stun) {
    const bySocket = /* @__PURE__ */ new Map();
    for (const c of srflx) {
      const set = bySocket.get(c.relatedPort) ?? /* @__PURE__ */ new Set();
      set.add(`${c.address}:${c.port}`);
      bySocket.set(c.relatedPort, set);
    }
    natType = [...bySocket.values()].some((s) => s.size > 1) ? "symmetric" : "cone";
  } else if (direct.length) natType = "udp-blocked";
  if (stun) notes.push("Direct connections to other players are possible from this network.");
  else notes.push("This network blocks direct connections (no reply from a STUN server). You'll need the relay to play online.");
  if (natType === "symmetric") {
    notes.push("Your network changes ports for every connection (symmetric NAT), so direct connections may fail and the relay may be needed.");
  }
  if (turn) notes.push("The relay server is reachable, so you should be able to connect even on a strict network.");
  else if (turnServers.length) notes.push("The relay server couldn't be reached from this network.");
  else notes.push("No relay server is set up, so players on strict networks (many schools) may not be able to connect.");
  return { stun, turn, natType, notes };
}

// sdk/p2p/src/index.ts
var HallPassP2P = {
  /** Semver of this SDK build. */
  version: P2P_VERSION,
  connect,
  selfTest,
  P2PError
};
var src_default = HallPassP2P;

export { HallPassP2P, P2PError, src_default as default };
