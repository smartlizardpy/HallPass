/**
 * HallPass — the event sidecar that rides alongside a gameplay recording.
 *
 * The video is the raw material; this file is what a LATER auto-edit (cut to
 * highlights, best-of reel across sessions) reads to know where to cut. v1 only
 * has to make that possible, so the format is small, versioned and additive:
 * new event types may appear in a later version, existing ones never change
 * meaning. The spec for consumers is `docs/game-recorder.md`.
 *
 * ── WHAT ZERO MEANS ─────────────────────────────────────────────────────────
 * Every `t` is milliseconds since the recorder's `start` event
 * (`clock: "mediarecorder-start"`). The first video frame can land a little
 * after that, so a consumer should allow roughly 100–200 ms of slack and cut
 * with a pre-roll rather than to the millisecond.
 *
 * ── WHAT IS DELIBERATELY NOT HERE ───────────────────────────────────────────
 * No player id, handle, name or email: this file is written to a child's device
 * and may be passed around. Score VALUES are logged because they are the
 * highlight signal; nothing that identifies who scored them is.
 *
 * ── THE LOG IS BOUNDED ──────────────────────────────────────────────────────
 * A game that submits a score sixty times a second must not be able to grow this
 * without limit (same reasoning as `error-log.ts`). Past {@link MAX_EVENTS} the
 * log stops adding and counts what it dropped, so the loss is stated in the file
 * rather than silent.
 */

export const SIDECAR_FORMAT = "hallpass-recording-events";
export const SIDECAR_VERSION = 1;

/** Hard cap on stored events. */
export const MAX_EVENTS = 2000;

/** Who observed the event. */
export type EventSource = "recorder" | "sdk" | "tester" | "game";

export type RecordingEventType =
  | "recording.start"
  | "recording.stop"
  | "score.submit"
  | "score.result"
  | "achievement"
  | "progress"
  | "game.error"
  | "visibility"
  | "report"
  | "mark"
  | "pause";

export type RecordingEvent = {
  /** Milliseconds since the recording started. */
  t: number;
  source: EventSource;
  type: RecordingEventType;
  data?: Record<string, unknown>;
};

/** Why a recording ended. */
export type EndedBy = "user" | "cap" | "navigated" | "error";

/** What the audio track of the take contains. */
export type AudioMode = "webaudio" | "none" | "unsupported";

export type SidecarMeta = {
  slug: string;
  title: string;
  file: string;
  mimeType: string;
  startedAtEpochMs: number;
  durationMs: number;
  width: number;
  height: number;
  audio: AudioMode;
  endedBy: EndedBy;
  canvasCount: number;
  userAgent: string;
};

export type Sidecar = {
  format: typeof SIDECAR_FORMAT;
  version: typeof SIDECAR_VERSION;
  clock: "mediarecorder-start";
  game: { slug: string; title: string };
  recording: {
    file: string;
    mimeType: string;
    startedAtEpochMs: number;
    durationMs: number;
    width: number;
    height: number;
    hasAudio: boolean;
    audio: AudioMode;
    endedBy: EndedBy;
    canvasCount: number;
  };
  device: { userAgent: string };
  droppedEvents: number;
  events: RecordingEvent[];
};

/** Collects events against one recording's clock. */
export class EventLog {
  private readonly events: RecordingEvent[] = [];
  private dropped = 0;

  constructor(private readonly startEpochMs: number) {}

  /**
   * Add an event observed at `atEpochMs` (default: now).
   *
   * Epoch milliseconds, not `performance.now()`: the game iframe has its own
   * time origin, so two raw `performance.now()` readings from different windows
   * cannot be compared. `performance.timeOrigin + performance.now()` can.
   *
   * Events from before the recording started clamp to 0 rather than going
   * negative — a queued SDK call replayed at load is still "at the start".
   */
  add(
    type: RecordingEventType,
    source: EventSource,
    data?: Record<string, unknown>,
    atEpochMs: number = Date.now(),
  ): void {
    if (this.events.length >= MAX_EVENTS) {
      this.dropped += 1;
      return;
    }
    const t = Math.max(0, Math.round(atEpochMs - this.startEpochMs));
    this.events.push(data ? { t, source, type, data } : { t, source, type });
  }

  /** Events in time order. Stable for equal times, so arrival order breaks ties. */
  snapshot(): RecordingEvent[] {
    return this.events
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.t - b.event.t || a.index - b.index)
      .map(({ event }) => event);
  }

  get droppedCount(): number {
    return this.dropped;
  }
}

export function buildSidecar(meta: SidecarMeta, log: EventLog): Sidecar {
  return {
    format: SIDECAR_FORMAT,
    version: SIDECAR_VERSION,
    clock: "mediarecorder-start",
    game: { slug: meta.slug, title: meta.title },
    recording: {
      file: meta.file,
      mimeType: meta.mimeType,
      startedAtEpochMs: meta.startedAtEpochMs,
      durationMs: Math.max(0, Math.round(meta.durationMs)),
      width: meta.width,
      height: meta.height,
      hasAudio: meta.audio === "webaudio",
      audio: meta.audio,
      endedBy: meta.endedBy,
      canvasCount: meta.canvasCount,
    },
    device: { userAgent: meta.userAgent },
    droppedEvents: log.droppedCount,
    events: log.snapshot(),
  };
}
