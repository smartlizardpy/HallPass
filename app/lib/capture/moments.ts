/**
 * HallPass - the beta session's log of game-reported moments.
 *
 * A game calls `HallPass.moment("boss-phase-2", { level: 4 })`; the injected shim
 * (`record-shim.ts`) hands the raw call to the session page, and this module
 * decides what to do with it. It is pure bookkeeping - no DOM, no capture - so the
 * rules are testable without a browser. Taking the picture is the session's job.
 *
 * ── NOTHING HERE LEAVES THE DEVICE ──────────────────────────────────────────
 * Moments live in the tester's tab. They are uploaded only if the tester pins one
 * to a bug report or sends it as a screenshot, through the paths that already
 * exist. That is deliberate: a Blob `put` is an "advanced operation" against a
 * 2,000-a-month allowance (`docs/blob-operations-design.md`), and a game that
 * marks a moment every few seconds must not be able to spend it.
 *
 * ── WHAT IS TRUSTED ─────────────────────────────────────────────────────────
 * Nothing. The arguments come from a game, so they are re-validated here with the
 * SDK's own rules (`sdk/src/moment.ts`) however well-behaved the SDK was.
 *
 * ── THE LOG IS BOUNDED ──────────────────────────────────────────────────────
 * Pictures are decoded bitmaps in a tab that may stay open for 40 minutes, so only
 * the newest {@link MAX_MOMENTS} are kept and the evicted ones are handed back for
 * their preview URLs to be revoked. Repeats of one name inside
 * {@link PICTURE_THROTTLE_MS} are still logged as events but get no picture.
 */

import { parseMoment, type ValidMoment } from "@/sdk/src/moment";
import type { Shot } from "./tab-capture";

/** Newest moments kept in the tab. */
export const MAX_MOMENTS = 12;

/** Minimum gap between pictures of the SAME moment name. */
export const PICTURE_THROTTLE_MS = 2000;

/** What the shim hands over: the game's raw arguments, untouched. */
export type RawMoment = {
  /** Epoch ms when the game made the call. */
  at: number;
  name: unknown;
  data: unknown;
  opts: unknown;
};

/** Why no picture is attached to a logged moment. */
export type NoShotReason = "event-only" | "throttled" | "failed";

export type Moment = {
  id: string;
  name: string;
  data: Record<string, unknown> | null;
  /** Epoch ms of the call. */
  at: number;
  shot: Shot | null;
  noShot: NoShotReason | null;
};

export type Admission = {
  moment: ValidMoment;
  at: number;
  /** Whether the caller should now try to take a picture. */
  takePicture: boolean;
  /** Set when `takePicture` is false. */
  noShot: NoShotReason | null;
};

export class MomentLog {
  private readonly entries: Moment[] = [];
  private readonly lastPicture = new Map<string, number>();
  private seq = 0;

  constructor(
    private readonly options: { max?: number; throttleMs?: number } = {},
  ) {}

  /**
   * Judge a raw call. Null when it is not a valid moment (dropped silently - the
   * SDK already told the game why). `now` is injected so tests need no clock.
   */
  admit(raw: RawMoment, now: number): Admission | null {
    const parsed = parseMoment(raw?.name, raw?.data, raw?.opts);
    if (!parsed.ok) return null;
    const { moment } = parsed;
    const at = Number.isFinite(raw.at) ? raw.at : now;

    if (!moment.shot) {
      return { moment, at, takePicture: false, noShot: "event-only" };
    }
    const last = this.lastPicture.get(moment.name);
    const throttle = this.options.throttleMs ?? PICTURE_THROTTLE_MS;
    if (last !== undefined && now - last < throttle) {
      return { moment, at, takePicture: false, noShot: "throttled" };
    }
    // Claimed on admission, not on success: a failing read must not be retried
    // sixty times a second by a game that marks the same moment every frame.
    this.lastPicture.set(moment.name, now);
    return { moment, at, takePicture: true, noShot: null };
  }

  /**
   * Record an admitted moment. Returns the entries pushed out of the log, so the
   * caller can revoke their preview URLs.
   */
  add(admission: Admission, shot: Shot | null, failed = false): { added: Moment; evicted: Moment[] } {
    this.seq += 1;
    const added: Moment = {
      id: `m${this.seq}`,
      name: admission.moment.name,
      data: admission.moment.data,
      at: admission.at,
      shot,
      noShot: shot ? null : admission.takePicture || failed ? "failed" : admission.noShot,
    };
    this.entries.push(added);
    const evicted: Moment[] = [];
    const max = this.options.max ?? MAX_MOMENTS;
    while (this.entries.length > max) {
      const dropped = this.entries.shift();
      if (dropped) evicted.push(dropped);
    }
    return { added, evicted };
  }

  /** Everything currently kept, oldest first. */
  list(): readonly Moment[] {
    return this.entries;
  }

  /** Empty the log and forget the throttle. Returns what was dropped. */
  clear(): Moment[] {
    this.lastPicture.clear();
    return this.entries.splice(0);
  }
}
