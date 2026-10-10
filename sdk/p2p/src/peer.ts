/**
 * One WebRTC link to one remote peer: an RTCPeerConnection with two negotiated
 * data channels (id 0 reliable+ordered, id 1 unordered with no retransmits).
 *
 * Negotiation is the W3C "perfect negotiation" pattern: either side may need to
 * (re)negotiate at any time — the first connection, an ICE restart, adding a
 * voice track — and when both offer at once the POLITE side yields. Signals go
 * out through `hooks.signal`; the room decides how they travel.
 *
 * The initiator creates the data channels up front (which triggers the first
 * offer); the responder creates its negotiated twins while answering, so the
 * first exchange is always a single offer/answer.
 *
 * Liveness: ICE `disconnected`/`failed` after the link was open → `disrupted`,
 * and an ICE restart is attempted (impolite side after 1.5 s, polite side after
 * 5 s, both retrying every 4 s). The reliable channel closing → `closed`.
 */

import { env } from "./env";
import { P2PError } from "./errors";
import type { SimulateOptions } from "./types";
import { CHUNK_BYTES, type Frame, Reassembler, frameSize, isChunk, split } from "./wire";

export type LinkState = "connecting" | "open" | "disrupted" | "closed";

export interface RtcSignal {
  k: "rtc";
  d?: RTCSessionDescriptionInit;
  c?: RTCIceCandidateInit;
}

export interface LinkHooks {
  signal(data: RtcSignal): void;
  frame(frame: string | ArrayBuffer | Uint8Array, reliable: boolean): void;
  state(s: LinkState): void;
  track(ev: RTCTrackEvent): void;
  log(...a: unknown[]): void;
}

const HIGH_WATER = 1 << 20;
const LOW_WATER = 256 << 10;
const MAX_QUEUED = 16 << 20;
const UNRELIABLE_DROP = 64 << 10;

export class PeerLink {
  readonly pc: RTCPeerConnection;
  state: LinkState = "connecting";
  /** Remote description applied at least once: the other side answered. */
  negotiated = false;
  /** ICE reported `failed` before the link ever opened. */
  failed = false;
  relay = false;
  bytesIn = 0;
  bytesOut = 0;
  audioSender: RTCRtpSender | null = null;

  private rel?: RTCDataChannel;
  private unrel?: RTCDataChannel;
  private queue: Frame[] = [];
  private queued = 0;
  private msgId = 0;
  private reasm = new Reassembler();
  private makingOffer = false;
  private ignoreOffer = false;
  private answerPending = false;
  private chain: Promise<void> = Promise.resolve();
  private early: RTCIceCandidateInit[] = [];
  private restartTimer?: ReturnType<typeof setTimeout>;
  private simQ: Array<[number, Frame]> = [];
  private simTimer?: ReturnType<typeof setTimeout>;
  private simLast = 0;

  constructor(
    readonly id: string,
    readonly polite: boolean,
    initiator: boolean,
    config: RTCConfiguration,
    private sim: SimulateOptions | null,
    private hooks: LinkHooks,
  ) {
    const PC = env.RTCPeerConnection;
    if (!PC) throw new P2PError("unsupported", "This browser doesn't support peer-to-peer connections (WebRTC).");
    const pc = (this.pc = new PC(config));
    pc.onicecandidate = (e) => {
      if (e.candidate) hooks.signal({ k: "rtc", c: e.candidate.toJSON() });
    };
    pc.onnegotiationneeded = () => void this.offer();
    pc.oniceconnectionstatechange = () => this.update();
    pc.onconnectionstatechange = () => this.update();
    pc.ontrack = (e) => hooks.track(e);
    if (initiator) this.channels();
  }

  get open(): boolean {
    return this.state === "open";
  }

  /** Apply a signal from the remote side. Serialised: one at a time, in order. */
  signal(msg: RtcSignal): void {
    this.chain = this.chain.then(() => this.apply(msg)).catch((e) => this.hooks.log("signal failed", this.id, e));
  }

  /** Send a frame. Reliable frames queue under backpressure; unreliable ones drop. */
  send(frame: Frame, reliable: boolean): void {
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
        "Too much data is waiting to be sent to another player. Send less, or less often.",
      );
    }
    if (frameSize(frame) > CHUNK_BYTES) for (const part of split(frame, this.msgId++)) this.transmit(part, true);
    else this.transmit(frame, true);
  }

  /** Close once the reliable channel has drained (≤ `maxMs`), so a last `bye` gets out. */
  closeSoon(maxMs = 400): void {
    const start = env.now();
    const tick = () => {
      if (this.state === "closed") return;
      if (!this.queue.length && (this.rel?.bufferedAmount ?? 0) === 0 && env.now() - start > 50) return this.close();
      if (env.now() - start > maxMs) return this.close();
      setTimeout(tick, 25);
    };
    tick();
  }

  close(): void {
    if (this.state === "closed") return;
    this.state = "closed";
    clearTimeout(this.restartTimer);
    clearTimeout(this.simTimer);
    try {
      this.rel?.close();
      this.unrel?.close();
      this.pc.close();
    } catch {
      // already gone
    }
    this.hooks.state("closed");
  }

  /** Add (or swap) the local voice track; `null` stops sending without renegotiating. */
  setAudio(track: MediaStreamTrack | null, stream?: MediaStream): void {
    if (this.state === "closed") return;
    try {
      if (this.audioSender) void this.audioSender.replaceTrack(track);
      else if (track && stream) this.audioSender = this.pc.addTrack(track, stream);
    } catch (e) {
      this.hooks.log("audio track failed", this.id, e);
    }
  }

  async stats(): Promise<{ rttMs: number | null; bytesIn: number; bytesOut: number; relay: boolean }> {
    const out = { rttMs: null as number | null, bytesIn: this.bytesIn, bytesOut: this.bytesOut, relay: this.relay };
    try {
      const report = await this.pc.getStats();
      type S = Record<string, unknown> & { type: string };
      let pair: S | undefined;
      report.forEach((s: S) => {
        if (s.type === "transport" && s.selectedCandidatePairId) pair = report.get(s.selectedCandidatePairId as string);
      });
      if (!pair) {
        report.forEach((s: S) => {
          if (s.type === "candidate-pair" && s.state === "succeeded" && (s.selected || s.nominated)) pair = s;
        });
      }
      if (pair) {
        const local = report.get(pair.localCandidateId as string) as S | undefined;
        const remote = report.get(pair.remoteCandidateId as string) as S | undefined;
        this.relay = local?.candidateType === "relay" || remote?.candidateType === "relay";
        out.relay = this.relay;
        if (typeof pair.currentRoundTripTime === "number") out.rttMs = pair.currentRoundTripTime * 1000;
        if (typeof pair.bytesReceived === "number") out.bytesIn = pair.bytesReceived;
        if (typeof pair.bytesSent === "number") out.bytesOut = pair.bytesSent;
      }
    } catch {
      // stats are best-effort
    }
    return out;
  }

  // ── negotiation ────────────────────────────────────────────────────────────

  private async offer(): Promise<void> {
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

  private emitDescription(): void {
    const d = this.pc.localDescription;
    if (d) this.hooks.signal({ k: "rtc", d: { type: d.type, sdp: d.sdp } });
  }

  private async apply({ d, c }: RtcSignal): Promise<void> {
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

  private async candidate(c: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pc.addIceCandidate(c);
    } catch (e) {
      if (!this.ignoreOffer) this.hooks.log("candidate rejected", this.id, e);
    }
  }

  private channels(): void {
    if (this.rel) return;
    const rel = this.pc.createDataChannel("hp-r", { negotiated: true, id: 0, ordered: true });
    const unrel = this.pc.createDataChannel("hp-u", { negotiated: true, id: 1, ordered: false, maxRetransmits: 0 });
    this.rel = rel;
    this.unrel = unrel;
    for (const [ch, reliable] of [
      [rel, true],
      [unrel, false],
    ] as const) {
      ch.binaryType = "arraybuffer";
      ch.onmessage = (e: MessageEvent) => this.receive(e.data as string | ArrayBuffer, reliable);
      ch.onopen = () => this.update();
    }
    rel.onclose = () => this.close();
    rel.bufferedAmountLowThreshold = LOW_WATER;
    rel.onbufferedamountlow = () => this.flush();
  }

  private update(): void {
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
      this.restartIn(this.polite ? 5000 : 1500);
    } else if (ice === "failed" && this.state === "connecting") {
      this.failed = true;
      this.hooks.state("connecting");
    }
  }

  private restartIn(ms: number): void {
    clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(async () => {
      if (this.state !== "disrupted") return;
      try {
        // An earlier restart offer that never got an answer would block this one.
        if (this.pc.signalingState === "have-local-offer") await this.pc.setLocalDescription({ type: "rollback" });
        this.hooks.log("ICE restart", this.id);
        this.pc.restartIce();
      } catch (e) {
        this.hooks.log("ICE restart failed", this.id, e);
      }
      this.restartIn(4000);
    }, ms);
  }

  // ── frames ─────────────────────────────────────────────────────────────────

  private receive(data: string | ArrayBuffer, reliable: boolean): void {
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
  private transmit(frame: Frame, reliable: boolean): void {
    const sim = this.sim;
    if (!sim) return reliable ? this.enqueue(frame) : this.raw(this.unrel, frame);
    if (!reliable && env.random() * 100 < (sim.lossPct ?? 0)) return;
    let at = env.now() + (sim.latencyMs ?? 0) + env.random() * (sim.jitterMs ?? 0);
    if (!reliable) {
      setTimeout(() => this.unrel?.readyState === "open" && this.raw(this.unrel, frame), at - env.now());
      return;
    }
    // Reliable frames keep their order: never scheduled before the previous one.
    at = Math.max(at, this.simLast);
    this.simLast = at;
    this.simQ.push([at, frame]);
    if (!this.simTimer) this.pump();
  }

  private pump = (): void => {
    this.simTimer = undefined;
    const now = env.now();
    while (this.simQ.length && this.simQ[0][0] <= now) this.enqueue(this.simQ.shift()![1]);
    if (this.simQ.length) this.simTimer = setTimeout(this.pump, Math.max(1, this.simQ[0][0] - now));
  };

  private enqueue(frame: Frame): void {
    const ch = this.rel;
    if (!this.queue.length && ch?.readyState === "open" && ch.bufferedAmount < HIGH_WATER) {
      this.raw(ch, frame);
      return;
    }
    this.queue.push(frame);
    this.queued += frameSize(frame);
  }

  private flush(): void {
    const ch = this.rel;
    if (!ch || ch.readyState !== "open") return;
    while (this.queue.length && ch.bufferedAmount < HIGH_WATER) {
      const f = this.queue.shift()!;
      this.queued -= frameSize(f);
      this.raw(ch, f);
    }
  }

  private raw(ch: RTCDataChannel | undefined, frame: Frame): void {
    if (!ch || ch.readyState !== "open") return;
    try {
      ch.send(frame as string & ArrayBufferView<ArrayBuffer>);
      this.bytesOut += typeof frame === "string" ? frame.length : frame.byteLength;
    } catch (e) {
      this.hooks.log("send failed", this.id, e);
    }
  }
}
