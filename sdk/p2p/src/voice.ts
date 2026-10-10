/**
 * Voice: one microphone track sent to every player, one raw MediaStream per
 * remote player handed to the game (which does its own spatial audio).
 *
 * Off until the game calls `start()`, which is what triggers the browser's
 * microphone prompt. The first `start()` adds an audio track to each link (one
 * renegotiation, carried over the data channel); after that, `stop()`/`start()`
 * swap the track with `replaceTrack` and tell peers with a `voice` control
 * message, so toggling voice never renegotiates.
 *
 * CHROME QUIRK. A remote WebRTC audio stream fed into Web Audio
 * (`createMediaStreamSource`) stays silent in Chrome unless the same stream is
 * also attached to a media element. The SDK attaches every remote stream to a
 * MUTED `<audio>` element it owns, so games can go straight to a PannerNode.
 */

import { Emitter } from "./emitter";
import { env } from "./env";
import { P2PError } from "./errors";
import type { PeerLink } from "./peer";
import type { RoomImpl } from "./room";
import type { Voice, VoiceStartOptions } from "./types";

interface Remote {
  stream?: MediaStream;
  /** The peer says its voice is on. */
  on: boolean;
  emitted: boolean;
  muted: boolean;
  el?: HTMLAudioElement;
}

export class VoiceImpl implements Voice {
  private ev = new Emitter((e) => console.error("[hallpass-p2p] voice handler threw:", e));
  private stream: MediaStream | null = null;
  private track: MediaStreamTrack | null = null;
  private isMuted = false;
  private remote = new Map<string, Remote>();

  constructor(
    private room: RoomImpl,
    private log: (...a: unknown[]) => void,
  ) {}

  get active(): boolean {
    return !!this.track;
  }

  get muted(): boolean {
    return this.isMuted;
  }

  async start(opts: VoiceStartOptions = {}): Promise<void> {
    if (this.track) return;
    if (this.room.closed) throw new P2PError("closed", "You're no longer in this room.");
    let stream: MediaStream;
    try {
      stream = await env.getUserMedia({
        audio: {
          echoCancellation: opts.echoCancellation ?? true,
          noiseSuppression: opts.noiseSuppression ?? true,
          autoGainControl: opts.autoGainControl ?? true,
        },
        video: false,
      });
    } catch (e) {
      const name = (e as { name?: string } | null)?.name;
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

  stop(): void {
    if (!this.track) return;
    this.track.stop();
    this.track = null;
    this.stream = null;
    this.room.forEachOpenLink((l) => {
      l.setAudio(null);
      this.room.control(l, "voice", false);
    });
  }

  setMuted(muted: boolean): void {
    this.isMuted = !!muted;
    if (this.track) this.track.enabled = !this.isMuted;
  }

  setPeerMuted(peerId: string, muted: boolean): void {
    const r = this.get(peerId);
    r.muted = !!muted;
    this.applyMute(r);
  }

  on(event: "stream" | "stream-end", cb: (e: never) => void): () => void {
    const off = this.ev.on(event, cb as (...a: unknown[]) => void);
    // A game that subscribes late still hears about streams that already arrived.
    if (event === "stream") {
      for (const [peerId, r] of this.remote) {
        if (r.emitted && r.stream) this.ev.emitTo(cb as (...a: unknown[]) => void, { peerId, stream: r.stream });
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
  linkOpen(link: PeerLink): void {
    if (!this.track || !this.stream || link.state !== "open") return;
    link.setAudio(this.track, this.stream);
    this.room.control(link, "voice", true);
  }

  onTrack(peerId: string, e: RTCTrackEvent): void {
    if (e.track.kind !== "audio") return;
    const r = this.get(peerId);
    const MS = env.MediaStream;
    r.stream = e.streams[0] ?? (MS ? new MS([e.track]) : undefined);
    this.applyMute(r);
    this.check(peerId);
  }

  remoteFlag(peerId: string, on: boolean): void {
    this.get(peerId).on = on;
    this.check(peerId);
  }

  detach(peerId: string): void {
    const r = this.remote.get(peerId);
    if (!r) return;
    if (r.emitted) this.ev.emit("stream-end", { peerId });
    if (r.el) r.el.srcObject = null;
    this.remote.delete(peerId);
  }

  shutdown(): void {
    this.stop();
    for (const id of [...this.remote.keys()]) this.detach(id);
  }

  private get(peerId: string): Remote {
    let r = this.remote.get(peerId);
    if (!r) this.remote.set(peerId, (r = { on: false, emitted: false, muted: false }));
    return r;
  }

  private applyMute(r: Remote): void {
    r.stream?.getAudioTracks().forEach((t) => (t.enabled = !r.muted));
  }

  private check(peerId: string): void {
    const r = this.remote.get(peerId);
    if (!r) return;
    if (r.on && r.stream && !r.emitted) {
      r.emitted = true;
      if (!r.el && typeof Audio !== "undefined") {
        try {
          const el = new Audio();
          el.muted = true;
          el.srcObject = r.stream;
          void el.play().catch(() => {});
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
}
