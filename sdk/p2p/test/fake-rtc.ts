/**
 * An in-memory RTCPeerConnection for unit tests — just enough of the real API
 * for `peer.ts`: offer/answer state machine (with implicit rollback), trickled
 * candidates, negotiated data channels, `restartIce`, stats, and a `net`
 * controller that can cut and restore the "network" between two connections.
 *
 * Two connections pair up when an offer/answer round completes: the SDP text
 * carries the sender's id. Data-channel messages are delivered in order on a
 * macrotask; while a pair is cut, unreliable messages are dropped and reliable
 * ones are held and delivered after the link reconnects (as SCTP would).
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Handler<E = any> = ((ev: E) => void) | null;

const registry = new Map<string, FakePC>();
let seq = 0;

function pairKey(a: FakePC, b: FakePC): string {
  return [a.uid, b.uid].sort().join("|");
}

const cuts = new Set<string>();

export const net = {
  /** Every connection created so far. */
  all(): FakePC[] {
    return [...registry.values()];
  },
  cut(a: FakePC): void {
    const b = a.remote;
    if (!b) return;
    cuts.add(pairKey(a, b));
    for (const pc of [a, b]) pc.setIce("disconnected");
  },
  restore(a: FakePC): void {
    const b = a.remote;
    if (b) cuts.delete(pairKey(a, b));
  },
  isCut(a: FakePC, b: FakePC): boolean {
    return cuts.has(pairKey(a, b));
  },
  reset(): void {
    registry.clear();
    cuts.clear();
  },
};

class FakeDC {
  readyState: RTCDataChannelState = "connecting";
  bufferedAmount = 0;
  bufferedAmountLowThreshold = 0;
  binaryType = "arraybuffer";
  onopen: Handler = null;
  onclose: Handler = null;
  onmessage: Handler<{ data: unknown }> = null;
  onbufferedamountlow: Handler = null;
  private held: Array<() => void> = [];

  constructor(
    readonly pc: FakePC,
    readonly label: string,
    readonly id: number,
    readonly reliable: boolean,
  ) {}

  send(data: string | ArrayBuffer | ArrayBufferView): void {
    if (this.readyState !== "open") throw new Error("InvalidStateError: channel not open");
    const size = typeof data === "string" ? data.length : data.byteLength;
    const copy =
      typeof data === "string"
        ? data
        : data instanceof ArrayBuffer
          ? data.slice(0)
          : (data.buffer as ArrayBuffer).slice(data.byteOffset, data.byteOffset + data.byteLength);
    this.bufferedAmount += size;
    const deliver = () => {
      const before = this.bufferedAmount;
      this.bufferedAmount -= size;
      if (before > this.bufferedAmountLowThreshold && this.bufferedAmount <= this.bufferedAmountLowThreshold) {
        this.onbufferedamountlow?.({});
      }
      const twin = this.pc.remote?.channels.get(this.id);
      if (twin && twin.readyState === "open") twin.onmessage?.({ data: copy });
    };
    setTimeout(() => {
      const remote = this.pc.remote;
      if (remote && net.isCut(this.pc, remote)) {
        if (this.reliable) this.held.push(deliver);
        else this.bufferedAmount -= size;
        return;
      }
      deliver();
    }, 0);
  }

  flushHeld(): void {
    for (const f of this.held.splice(0)) setTimeout(f, 0);
  }

  open(): void {
    if (this.readyState !== "connecting") return;
    this.readyState = "open";
    this.onopen?.({});
  }

  close(): void {
    if (this.readyState === "closed") return;
    this.readyState = "closed";
    this.onclose?.({});
  }
}

interface Desc {
  type: RTCSdpType;
  sdp: string;
}

export class FakePC {
  readonly uid = `pc${++seq}`;
  signalingState: RTCSignalingState = "stable";
  iceConnectionState: RTCIceConnectionState = "new";
  connectionState: RTCPeerConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  localDescription: Desc | null = null;
  remoteDescription: Desc | null = null;
  onicecandidate: Handler = null;
  onnegotiationneeded: Handler = null;
  oniceconnectionstatechange: Handler = null;
  onconnectionstatechange: Handler = null;
  onicegatheringstatechange: Handler = null;
  ontrack: Handler = null;
  readonly channels = new Map<number, FakeDC>();
  remote: FakePC | null = null;
  private remoteUid: string | null = null;
  private appNegotiated = false;
  private restartWanted = false;
  private negQueued = false;
  private gen = 0;
  private senders: Array<{ track: unknown; replaceTrack: (t: unknown) => Promise<void> }> = [];
  private sendersNegotiated = 0;

  constructor(public config: RTCConfiguration = {}) {
    registry.set(this.uid, this);
  }

  createDataChannel(label: string, opts: RTCDataChannelInit): FakeDC {
    const dc = new FakeDC(this, label, opts.id ?? this.channels.size, opts.maxRetransmits !== 0);
    this.channels.set(dc.id, dc);
    if (!this.appNegotiated) this.queueNegotiation();
    else if (this.iceConnectionState === "connected") setTimeout(() => dc.open(), 0);
    return dc;
  }

  addTrack(track: unknown): { track: unknown; replaceTrack: (t: unknown) => Promise<void> } {
    const sender = {
      track,
      replaceTrack: async (t: unknown) => {
        sender.track = t;
      },
    };
    this.senders.push(sender);
    this.queueNegotiation();
    return sender;
  }

  getReceivers(): unknown[] {
    return [];
  }

  restartIce(): void {
    this.restartWanted = true;
    this.queueNegotiation();
  }

  private needsNegotiation(): boolean {
    return (
      (this.channels.size > 0 && !this.appNegotiated) || this.restartWanted || this.senders.length > this.sendersNegotiated
    );
  }

  private queueNegotiation(): void {
    if (this.negQueued || this.signalingState === "closed") return;
    this.negQueued = true;
    setTimeout(() => {
      this.negQueued = false;
      if (this.signalingState === "stable" && this.needsNegotiation()) this.onnegotiationneeded?.({});
    }, 0);
  }

  async createOffer(): Promise<Desc> {
    return { type: "offer", sdp: `fake ${this.uid} ${++this.gen}` };
  }

  async createAnswer(): Promise<Desc> {
    return { type: "answer", sdp: `fake ${this.uid} ${++this.gen}` };
  }

  async setLocalDescription(desc?: { type: RTCSdpType; sdp?: string }): Promise<void> {
    await Promise.resolve();
    if (this.signalingState === "closed") throw new Error("InvalidStateError: closed");
    if (desc?.type === "rollback") {
      this.signalingState = "stable";
      return;
    }
    const d: Desc =
      desc && desc.sdp
        ? (desc as Desc)
        : this.signalingState === "have-remote-offer"
          ? await this.createAnswer()
          : await this.createOffer();
    if (d.type === "offer") {
      if (this.signalingState !== "stable" && this.signalingState !== "have-local-offer") {
        throw new Error("InvalidStateError: cannot offer in " + this.signalingState);
      }
      this.signalingState = "have-local-offer";
    } else {
      if (this.signalingState !== "have-remote-offer") throw new Error("InvalidStateError: no offer to answer");
      this.signalingState = "stable";
    }
    this.localDescription = d;
    setTimeout(() => {
      if (this.signalingState === "closed") return;
      this.onicecandidate?.({
        candidate: {
          candidate: `candidate:1 1 udp 1 10.0.0.1 ${1000 + seq} typ host`,
          sdpMid: "0",
          sdpMLineIndex: 0,
          toJSON() {
            return { candidate: this.candidate, sdpMid: "0", sdpMLineIndex: 0 };
          },
        },
      });
      this.onicecandidate?.({ candidate: null });
    }, 0);
    if (d.type === "answer") this.complete();
  }

  async setRemoteDescription(d: Desc): Promise<void> {
    await Promise.resolve();
    if (this.signalingState === "closed") throw new Error("InvalidStateError: closed");
    if (d.type === "offer") {
      // have-local-offer here means glare: implicit rollback, as modern browsers do.
      this.signalingState = "have-remote-offer";
    } else {
      if (this.signalingState !== "have-local-offer") throw new Error("InvalidStateError: unexpected answer");
      this.signalingState = "stable";
    }
    this.remoteDescription = d;
    this.remoteUid = d.sdp.split(" ")[1];
    if (d.type === "answer") this.complete();
  }

  async addIceCandidate(c: RTCIceCandidateInit): Promise<void> {
    await Promise.resolve();
    if (!this.remoteDescription) throw new Error("InvalidStateError: no remote description");
    void c;
  }

  /** An offer/answer round finished on this side. The offerer finishes last. */
  private complete(): void {
    this.appNegotiated = this.appNegotiated || this.channels.size > 0;
    this.restartWanted = false;
    this.sendersNegotiated = this.senders.length;
    const other = this.remoteUid ? registry.get(this.remoteUid) : undefined;
    if (other) {
      this.remote = other;
      other.remote = this;
      if (this.signalingState === "stable" && other.signalingState === "stable") {
        other.appNegotiated = other.appNegotiated || other.channels.size > 0;
        other.restartWanted = false;
        setTimeout(() => this.connect(), 0);
      }
    }
    if (this.needsNegotiation()) this.queueNegotiation();
  }

  private connect(): void {
    const other = this.remote;
    if (!other || this.signalingState === "closed" || other.signalingState === "closed") return;
    if (net.isCut(this, other)) return;
    for (const pc of [this, other]) {
      pc.setIce("connected");
      for (const dc of pc.channels.values()) {
        dc.open();
        dc.flushHeld();
      }
    }
  }

  setIce(state: RTCIceConnectionState): void {
    if (this.signalingState === "closed" || this.iceConnectionState === state) return;
    this.iceConnectionState = state;
    this.connectionState = state === "connected" ? "connected" : state === "disconnected" ? "disconnected" : this.connectionState;
    this.oniceconnectionstatechange?.({});
    this.onconnectionstatechange?.({});
  }

  async getStats(): Promise<Map<string, Record<string, unknown>>> {
    return new Map<string, Record<string, unknown>>([
      ["t", { id: "t", type: "transport", selectedCandidatePairId: "cp" }],
      ["cp", { id: "cp", type: "candidate-pair", localCandidateId: "l", remoteCandidateId: "r", state: "succeeded", currentRoundTripTime: 0.002, bytesSent: 0, bytesReceived: 0 }],
      ["l", { id: "l", type: "local-candidate", candidateType: "host" }],
      ["r", { id: "r", type: "remote-candidate", candidateType: "host" }],
    ]);
  }

  getConfiguration(): RTCConfiguration {
    return this.config;
  }

  setConfiguration(c: RTCConfiguration): void {
    this.config = c;
  }

  close(): void {
    if (this.signalingState === "closed") return;
    for (const dc of this.channels.values()) dc.readyState = "closed";
    this.signalingState = "closed";
    this.iceConnectionState = "closed";
    this.connectionState = "closed";
    const other = this.remote;
    // While the pair is cut, the far side never hears about it (as with a real network).
    if (other && other.signalingState !== "closed" && !net.isCut(this, other)) {
      // The far side sees its channels close (SCTP shutdown).
      setTimeout(() => {
        for (const dc of other.channels.values()) dc.close();
      }, 0);
    }
  }
}

export function installFakeRTC(env: { RTCPeerConnection: unknown }): void {
  env.RTCPeerConnection = FakePC;
}
