/**
 * Shared-clock estimation (Cristian's algorithm with minimum-RTT filtering).
 *
 * A peer pings the host; the host answers with its clock. For one exchange
 *   offset = hostTime + rtt/2 - receiveTime
 * is exact when the two legs take equal time. Samples with the lowest RTT are
 * the ones least distorted by queueing, so the estimate is the median offset of
 * the 5 lowest-RTT samples among the last 24.
 */

const KEEP = 24;
const BEST = 5;

export class ClockSync {
  private samples: Array<{ rtt: number; offset: number }> = [];

  add(sentAt: number, hostTime: number, receivedAt: number): void {
    const rtt = receivedAt - sentAt;
    if (!(rtt >= 0) || !Number.isFinite(hostTime)) return;
    this.samples.push({ rtt, offset: hostTime + rtt / 2 - receivedAt });
    if (this.samples.length > KEEP) this.samples.shift();
  }

  get size(): number {
    return this.samples.length;
  }

  /** Estimated `hostClock - localClock`, or `null` before the first sample. */
  offset(): number | null {
    if (!this.samples.length) return null;
    const best = [...this.samples].sort((a, b) => a.rtt - b.rtt).slice(0, BEST);
    const offs = best.map((s) => s.offset).sort((a, b) => a - b);
    const mid = offs.length >> 1;
    return offs.length % 2 ? offs[mid] : (offs[mid - 1] + offs[mid]) / 2;
  }
}

/** Exponential moving average for displayed RTT. */
export function smooth(prev: number | null, sample: number): number {
  return prev == null ? sample : prev * 0.7 + sample * 0.3;
}
