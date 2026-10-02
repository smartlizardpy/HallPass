/**
 * HallPass — recording the game itself, for beta testers.
 *
 * `tab-capture.ts` records what the tab shows and needs `getDisplayMedia`, which
 * does not exist on iOS. This records the GAME: the picture is its own
 * `<canvas>` via `captureStream()`, the sound is its Web Audio output, both read
 * out of the same-origin iframe. No picker, no permission prompt, and it runs
 * wherever `MediaRecorder` does — which includes Safari, which is why the
 * container comes from `pickMimeType()` (webm where it can, mp4 where it must).
 *
 * ── PICTURE ─────────────────────────────────────────────────────────────────
 * The largest visible canvas, re-chosen at the moment Record is pressed (many
 * games only create it after a start click). Recorded DIRECTLY with
 * `captureStream`, never composited through `drawImage`: a composite would bring
 * back the exact "WebGL reads back blank" problem `dom-capture.ts` documents,
 * whereas a captured stream is correct for WebGL with no
 * `preserveDrawingBuffer`. The price is that a layered game records only its top
 * layer, which {@link RecordableGame.layered} lets the UI say out loud.
 *
 * ── SOUND ───────────────────────────────────────────────────────────────────
 * Needs the shim in `record-shim.ts`, present only when the document was loaded
 * with `?hp-rec=1`. Each tapped `AudioContext` gives a MediaStream; they are
 * mixed here, in a parent-owned context, into the one audio track MediaRecorder
 * can carry. No shim (offline, an `<audio>`-tag game, a browser without the
 * pieces) means a silent video and `audio: "none"` in the sidecar — said, not
 * implied.
 *
 * ── EVENTS ──────────────────────────────────────────────────────────────────
 * Anything that happens during the take is stamped against the MediaRecorder
 * `start` event and written to the sidecar; see `record-events.ts`.
 *
 * ── WHAT IT HOLDS ───────────────────────────────────────────────────────────
 * Encoded chunks only, capped in time and bytes by `record-policy.ts`. Hitting a
 * cap stops the recording and hands back what exists — a cap that throws the
 * take away would be worse than none.
 */

import { normaliseMessage, shortenFile } from "./error-log";
import { reachInto } from "./dom-capture";
import {
  buildSidecar,
  EventLog,
  type AudioMode,
  type EndedBy,
  type EventSource,
  type RecordingEventType,
  type Sidecar,
} from "./record-events";
import {
  capReached,
  chooseCanvas,
  isLayered,
  supportFailure,
  takeFileNames,
  visibleCanvasCount,
  type RecordFailure,
  type RecordLimits,
} from "./record-policy";
import { pickMimeType } from "./replay-buffer";

/** The slice of `window.__hpRec` (see `record-shim.ts`) this module uses. */
type ShimHandle = {
  streams: MediaStream[];
  onEvent: ((event: { at: number; type: string; source: string; data?: Record<string, unknown> }) => void) | null;
  onStream: ((stream: MediaStream) => void) | null;
};

/** A game that can be recorded right now. */
export type RecordableGame = {
  canvas: HTMLCanvasElement;
  win: Window;
  /** More than one big visible canvas: only the largest is recorded. */
  layered: boolean;
  canvasCount: number;
  /** The shim is in the page, so audio and SDK events are available. */
  shimmed: boolean;
};

export type ProbeResult =
  | ({ ok: true } & RecordableGame)
  | { ok: false; reason: RecordFailure };

/** Can the parent record at all, ignoring any particular game? */
export function browserSupportFailure(): RecordFailure | null {
  return supportFailure({
    hasMediaRecorder: typeof MediaRecorder !== "undefined",
    hasCaptureStream:
      typeof HTMLCanvasElement !== "undefined" &&
      typeof HTMLCanvasElement.prototype.captureStream === "function",
    mimeType: typeof MediaRecorder === "undefined" ? null : pickMimeType(),
  });
}

/**
 * Look into the game frame and say whether, and what, it can record.
 *
 * Cheap and side-effect free, so the UI can call it freely — on load to decide
 * whether to offer the control, and again at the click, when the canvas is up.
 */
export function probeRecordable(frame: HTMLIFrameElement | null): ProbeResult {
  if (!frame) return { ok: false, reason: "failed" };
  const unsupported = browserSupportFailure();
  if (unsupported) return { ok: false, reason: unsupported };

  const reached = reachInto(frame);
  if (!reached.ok) return { ok: false, reason: "cross-origin" };
  const win = frame.contentWindow;
  if (!win) return { ok: false, reason: "cross-origin" };

  const candidates = Array.from(reached.doc.querySelectorAll("canvas")).map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      element,
      width: element.width,
      height: element.height,
      renderedWidth: rect.width,
      renderedHeight: rect.height,
    };
  });

  const picked = chooseCanvas(candidates);
  if (!picked.ok) return picked;

  return {
    ok: true,
    canvas: picked.canvas.element,
    win,
    layered: isLayered(candidates),
    canvasCount: visibleCanvasCount(candidates),
    shimmed: Boolean((win as unknown as { __hpRec?: unknown }).__hpRec),
  };
}

export type RecordedTake = {
  video: Blob;
  mimeType: string;
  sidecar: Sidecar;
  fileNames: { video: string; events: string };
  durationMs: number;
  bytes: number;
  endedBy: EndedBy;
  /** Which cap ended it, when `endedBy` is `"cap"`. */
  cap: "time" | "size" | null;
};

type AudioContextCtor = typeof AudioContext;

function audioContextCtor(): AudioContextCtor | null {
  const w = window as unknown as {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

/** Same message arriving again within this window is one event, not a flood. */
const ERROR_DEDUPE_MS = 1000;

export class GameRecorder {
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private log: EventLog | null = null;
  private startEpochMs = 0;
  private startedPerf = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mixer: AudioContext | null = null;
  private mixerDest: MediaStreamAudioDestinationNode | null = null;
  private audioStreamsSeen = 0;
  private audio: AudioMode = "none";
  private videoStream: MediaStream | null = null;
  private detachErrors: () => void = () => {};
  private mimeType = "";
  private stopping: Promise<RecordedTake> | null = null;
  private pendingEnd: { endedBy: EndedBy; cap: "time" | "size" | null } = {
    endedBy: "user",
    cap: null,
  };

  constructor(
    private readonly game: RecordableGame,
    private readonly options: {
      slug: string;
      title: string;
      limits: RecordLimits;
      /** Once a second-ish: elapsed ms and bytes held so far. */
      onTick?: (elapsedMs: number, bytes: number) => void;
      /** The recording ended by itself (a cap, an error). Not called for `stop()`. */
      onAutoStop?: (take: RecordedTake) => void;
    },
  ) {}

  get isRecording(): boolean {
    return this.recorder !== null && !this.stopping;
  }

  /**
   * Begin recording. Must be called from the Record click: the audio mixer is a
   * new `AudioContext`, which starts suspended everywhere until a gesture.
   */
  async start(): Promise<{ ok: true } | { ok: false; reason: RecordFailure }> {
    const { limits } = this.options;
    try {
      const picked = pickMimeType();
      if (picked === null) return { ok: false, reason: "no-container" };
      this.mimeType = picked;

      this.videoStream = this.game.canvas.captureStream(limits.fps);
      const tracks: MediaStreamTrack[] = [...this.videoStream.getVideoTracks()];
      if (tracks.length === 0) return { ok: false, reason: "failed" };

      const audioTrack = this.buildAudioMixer();
      if (audioTrack) tracks.push(audioTrack);

      const stream = new MediaStream(tracks);
      const recorder = new MediaRecorder(stream, {
        ...(this.mimeType ? { mimeType: this.mimeType } : {}),
        videoBitsPerSecond: limits.videoBitsPerSecond,
        audioBitsPerSecond: limits.audioBitsPerSecond,
      });
      this.recorder = recorder;

      recorder.addEventListener("dataavailable", (event) => {
        if (!event.data || event.data.size === 0) return;
        this.chunks.push(event.data);
        this.bytes += event.data.size;
        this.checkCaps();
      });
      recorder.addEventListener("error", () => {
        this.autoStop("error", null);
      });

      // Time zero is the recorder's own `start` event, not the click: the encoder
      // takes a moment to come up and the video begins there.
      const started = new Promise<void>((resolve) =>
        recorder.addEventListener("start", () => resolve(), { once: true }),
      );
      // A timeslice keeps `dataavailable` flowing so the byte cap can act and an
      // interrupted take still has its data (same reasoning as ReplayBuffer).
      recorder.start(1000);
      await started;

      this.startEpochMs = Date.now();
      this.startedPerf = performance.now();
      this.log = new EventLog(this.startEpochMs);
      this.log.add("recording.start", "recorder", undefined, this.startEpochMs);
      this.wireEvents();

      this.timer = setInterval(() => {
        const elapsed = performance.now() - this.startedPerf;
        this.options.onTick?.(elapsed, this.bytes);
        this.checkCaps();
      }, 250);
      return { ok: true };
    } catch {
      this.teardown();
      return { ok: false, reason: "failed" };
    }
  }

  /** Record something that happened during the take. No-op when not recording. */
  addEvent(
    type: RecordingEventType,
    source: EventSource,
    data?: Record<string, unknown>,
  ): void {
    if (!this.isRecording) return;
    this.log?.add(type, source, data);
  }

  /** Finish the take and return it. Safe to call twice; the second call gets the same one. */
  stop(endedBy: EndedBy = "user"): Promise<RecordedTake> {
    if (this.stopping) return this.stopping;
    if (this.pendingEnd.endedBy === "user") this.pendingEnd = { endedBy, cap: null };
    this.stopping = this.finish();
    return this.stopping;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private checkCaps(): void {
    if (this.stopping) return;
    const cap = capReached(
      this.options.limits,
      performance.now() - this.startedPerf,
      this.bytes,
    );
    if (cap) this.autoStop("cap", cap);
  }

  private autoStop(endedBy: EndedBy, cap: "time" | "size" | null): void {
    if (this.stopping) return;
    this.pendingEnd = { endedBy, cap };
    this.stopping = this.finish();
    void this.stopping.then((take) => this.options.onAutoStop?.(take));
  }

  /**
   * Mix every tapped Web Audio stream into one track, including contexts the
   * game creates DURING the take. Returns null (and records `audio: "none"` or
   * `"unsupported"`) when there is nothing to mix into.
   */
  private buildAudioMixer(): MediaStreamTrack | null {
    const hp = (this.game.win as unknown as { __hpRec?: ShimHandle }).__hpRec;
    if (!hp) {
      this.audio = "none";
      return null;
    }
    const Ctor = audioContextCtor();
    if (!Ctor) {
      this.audio = "unsupported";
      return null;
    }
    try {
      const mixer = new Ctor();
      void mixer.resume().catch(() => {});
      const dest = mixer.createMediaStreamDestination();
      const add = (stream: MediaStream) => {
        try {
          if (stream.getAudioTracks().length === 0) return;
          mixer.createMediaStreamSource(stream).connect(dest);
          this.audioStreamsSeen += 1;
        } catch {
          /* one unreadable context must not cost the rest */
        }
      };
      hp.streams.forEach(add);
      hp.onStream = add;
      this.mixer = mixer;
      this.mixerDest = dest;
      const track = dest.stream.getAudioTracks()[0];
      return track ?? null;
    } catch {
      this.audio = "unsupported";
      return null;
    }
  }

  /** Subscribe to the shim's events and to the game's own errors. */
  private wireEvents(): void {
    const hp = (this.game.win as unknown as { __hpRec?: ShimHandle }).__hpRec;
    if (hp) {
      hp.onEvent = (event) => {
        this.log?.add(
          event.type as RecordingEventType,
          event.source as EventSource,
          event.data,
          event.at,
        );
      };
    }

    // The game's errors. `ErrorLog` already keeps these for bug reports; this is
    // the timestamped copy for the sidecar, so a crash shows up on the timeline.
    const win = this.game.win;
    const lastSeen = new Map<string, number>();
    const record = (message: string, file?: string, line?: number) => {
      const now = performance.now();
      const last = lastSeen.get(message);
      if (last !== undefined && now - last < ERROR_DEDUPE_MS) return;
      lastSeen.set(message, now);
      this.addEvent("game.error", "game", {
        message,
        ...(file ? { file } : {}),
        ...(line !== undefined ? { line } : {}),
      });
    };
    const onError = (e: ErrorEvent) =>
      record(
        normaliseMessage(e.error ?? e.message),
        shortenFile(e.filename),
        typeof e.lineno === "number" ? e.lineno : undefined,
      );
    const onRejection = (e: PromiseRejectionEvent) => record(normaliseMessage(e.reason));
    try {
      win.addEventListener("error", onError);
      win.addEventListener("unhandledrejection", onRejection);
      this.detachErrors = () => {
        try {
          win.removeEventListener("error", onError);
          win.removeEventListener("unhandledrejection", onRejection);
        } catch {
          /* the frame is already gone */
        }
      };
    } catch {
      /* cross-origin mid-take; no errors, recording carries on */
    }
  }

  private async finish(): Promise<RecordedTake> {
    const recorder = this.recorder;
    const { endedBy, cap } = this.pendingEnd;
    const elapsed = performance.now() - this.startedPerf;
    this.log?.add("recording.stop", "recorder");

    if (recorder && recorder.state !== "inactive") {
      // `stop()` flushes a final `dataavailable` BEFORE `stop` fires, so the blob
      // can only be assembled after it (see ReplayBuffer.finalise).
      await new Promise<void>((resolve) => {
        recorder.addEventListener("stop", () => resolve(), { once: true });
        try {
          recorder.stop();
        } catch {
          resolve();
        }
      });
    }

    const audio: AudioMode =
      this.audio === "none" && this.mixer
        ? this.audioStreamsSeen > 0
          ? "webaudio"
          : "none"
        : this.audio;
    const mimeType = recorder?.mimeType || this.mimeType || "video/webm";
    const fileNames = takeFileNames(this.options.slug, new Date(this.startEpochMs), mimeType);
    const video = new Blob(this.chunks, { type: mimeType });
    const sidecar = buildSidecar(
      {
        slug: this.options.slug,
        title: this.options.title,
        file: fileNames.video,
        mimeType,
        startedAtEpochMs: this.startEpochMs,
        durationMs: elapsed,
        width: this.game.canvas.width,
        height: this.game.canvas.height,
        audio,
        endedBy,
        canvasCount: this.game.canvasCount,
        userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      },
      this.log ?? new EventLog(this.startEpochMs),
    );
    this.teardown();
    return { video, mimeType, sidecar, fileNames, durationMs: elapsed, bytes: video.size, endedBy, cap };
  }

  /** Release every handle. Idempotent. */
  private teardown(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.detachErrors();
    this.detachErrors = () => {};
    const hp = (this.game.win as unknown as { __hpRec?: ShimHandle }).__hpRec;
    try {
      if (hp) {
        hp.onEvent = null;
        hp.onStream = null;
      }
    } catch {
      /* frame gone */
    }
    this.videoStream?.getTracks().forEach((t) => t.stop());
    this.mixerDest?.stream.getTracks().forEach((t) => t.stop());
    void this.mixer?.close().catch(() => {});
    this.mixer = null;
    this.mixerDest = null;
  }
}
