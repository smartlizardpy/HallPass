/**
 * HallPass — the rolling replay buffer.
 *
 * Keeps the last ~30 seconds of a test session in memory so that pressing the
 * bug shortcut can attach what just happened, rather than asking the tester to
 * have known in advance that they were about to hit a bug.
 *
 * ── WHY TWO RECORDERS AND NOT ONE ───────────────────────────────────────────
 * The obvious design is one `MediaRecorder` with `start(1000)`, keeping the last
 * 30 chunks. It does not work, for two compounding reasons:
 *
 *   1. THE HEADER IS ONLY IN THE FIRST CHUNK. WebM/Matroska writes its EBML
 *      header and track metadata once, at the start. A tail of chunks has no
 *      header, so nothing will decode it.
 *   2. A KEYFRAME BOUNDARY IS NOT GUARANTEED. Even prepending a saved header,
 *      the tail begins wherever it begins — usually mid-GOP — so the first
 *      second or so decodes as smeared garbage. Keyframe interval is up to the
 *      encoder and is not configurable.
 *
 * The trick used here instead: run TWO recorders on the same stream, each on a
 * {@link WINDOW_MS} cycle, started {@link WINDOW_MS}/2 apart. Because
 * `stop()` finalises a recording into a complete, self-contained file, at any
 * instant the OLDER of the two holds a valid clip covering between half and a
 * full window of history. Flushing means stopping that one and taking its blob.
 *
 * The cost is honest and worth stating: clip length varies between 15 and 30
 * seconds depending on where in the cycle the flush lands. That is the price of
 * every clip being guaranteed to play, and a clip that plays is worth far more
 * than a longer one that might not.
 *
 * ── MEMORY ──────────────────────────────────────────────────────────────────
 * Only two encoded blobs are ever held, each capped by the bitrate below —
 * roughly 2–4 MB total, regardless of session length. Raw frames are never
 * retained.
 */

/** One recorder's cycle. Each holds up to this much; two of them overlap. */
export const WINDOW_MS = 30_000;

/**
 * Video bitrate for replay clips.
 *
 * Deliberately low. A bug repro needs to be legible, not beautiful, and this is
 * the difference between a ~3 MB clip and a ~12 MB one on a free-tier blob store
 * that is already being watched. 30 s at 1.2 Mbps is about 4.5 MB before the
 * codec's own savings on mostly-static game scenes.
 */
export const VIDEO_BITS_PER_SECOND = 1_200_000;

/**
 * Preference order for the container.
 *
 * VP9 first for size, VP8 as the broadly-supported fallback, then MP4 because
 * Safari's `MediaRecorder` produces H.264 in MP4 and not WebM at all. The empty
 * string is the last resort: it lets the browser choose, which is better than
 * refusing to record.
 */
const MIME_CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4",
  "",
];

/** The first supported container, or `null` when recording is impossible. */
export function pickMimeType(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type),
): string | null {
  for (const candidate of MIME_CANDIDATES) {
    // The empty string means "browser's default" and cannot be probed.
    if (candidate === "") return "";
    try {
      if (isSupported(candidate)) return candidate;
    } catch {
      // isTypeSupported throws on some older engines rather than returning
      // false; treat that as unsupported and keep looking.
    }
  }
  return null;
}

/** File extension for a container, for the upload path. */
export function extensionFor(mimeType: string): "webm" | "mp4" {
  return mimeType.includes("mp4") ? "mp4" : "webm";
}

export type ReplayClip = {
  blob: Blob;
  mimeType: string;
  /** How much history this clip actually covers. */
  durationMs: number;
};

/** True when this browser can record a stream at all. */
export function canRecord(): boolean {
  return typeof MediaRecorder !== "undefined" && pickMimeType() !== null;
}

/**
 * A pair of staggered recorders over one stream.
 *
 * `start()` begins recording; `flush()` returns the best available clip and
 * keeps recording, so a tester can file several reports in one session.
 */
export class ReplayBuffer {
  private readonly mimeType: string;
  private recorders: {
    recorder: MediaRecorder;
    chunks: Blob[];
    startedAt: number;
  }[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  private running = false;

  constructor(
    private readonly stream: MediaStream,
    mimeType?: string,
  ) {
    this.mimeType = mimeType ?? pickMimeType() ?? "";
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.spawn();
    // The second recorder starts half a window later, which is what guarantees
    // one of the two always holds at least WINDOW_MS/2 of history.
    this.timers.push(setTimeout(() => this.running && this.spawn(), WINDOW_MS / 2));
  }

  stop(): void {
    this.running = false;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    for (const slot of this.recorders) {
      try {
        if (slot.recorder.state !== "inactive") slot.recorder.stop();
      } catch {
        /* already torn down */
      }
    }
    this.recorders = [];
  }

  /**
   * Finalise and return the clip with the most history.
   *
   * Resolves `null` when nothing has been recorded yet — a flush in the first
   * moments of a session, before any recorder has data.
   */
  async flush(): Promise<ReplayClip | null> {
    // The OLDEST recorder holds the most history, which is what a bug report
    // wants: the run-up, not the aftermath.
    const oldest = this.recorders
      .slice()
      .sort((a, b) => a.startedAt - b.startedAt)[0];
    if (!oldest) return null;

    const durationMs = Date.now() - oldest.startedAt;
    const blob = await this.finalise(oldest);
    if (!blob || blob.size === 0) return null;

    // Replace the one we consumed so the buffer keeps covering the session.
    if (this.running) this.spawn();

    return { blob, mimeType: this.mimeType, durationMs };
  }

  /** Stop one recorder and resolve its complete, self-contained file. */
  private finalise(slot: {
    recorder: MediaRecorder;
    chunks: Blob[];
  }): Promise<Blob | null> {
    return new Promise((resolve) => {
      this.recorders = this.recorders.filter((s) => s !== slot);
      if (slot.recorder.state === "inactive") {
        resolve(slot.chunks.length ? new Blob(slot.chunks, { type: this.mimeType }) : null);
        return;
      }
      // `stop` flushes a final `dataavailable` BEFORE `stop` fires, so the blob
      // is only assembled here — assembling on `dataavailable` would miss it.
      slot.recorder.addEventListener(
        "stop",
        () =>
          resolve(
            slot.chunks.length ? new Blob(slot.chunks, { type: this.mimeType }) : null,
          ),
        { once: true },
      );
      try {
        slot.recorder.stop();
      } catch {
        resolve(null);
      }
    });
  }

  /** Start one recorder and schedule its own recycling. */
  private spawn(): void {
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(this.stream, {
        ...(this.mimeType ? { mimeType: this.mimeType } : {}),
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
    } catch {
      // A container the browser claimed to support can still be refused by the
      // constructor. Recording simply does not happen; the session continues.
      this.running = false;
      return;
    }

    const slot = { recorder, chunks: [] as Blob[], startedAt: Date.now() };
    recorder.addEventListener("dataavailable", (event) => {
      if (event.data && event.data.size > 0) slot.chunks.push(event.data);
    });
    this.recorders.push(slot);

    try {
      // A timeslice keeps `dataavailable` firing, so a recorder that is stopped
      // mid-window still has its data. Without it, some engines only emit at
      // stop and an interrupted recording yields nothing.
      recorder.start(1000);
    } catch {
      this.recorders = this.recorders.filter((s) => s !== slot);
      return;
    }

    // Recycle this recorder a full window later, so it never grows unbounded.
    this.timers.push(
      setTimeout(() => {
        if (!this.running) return;
        void this.finalise(slot);
        this.spawn();
      }, WINDOW_MS),
    );
  }
}
