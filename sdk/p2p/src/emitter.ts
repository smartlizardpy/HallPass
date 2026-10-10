/**
 * Event emitter with ASYNC, ORDERED delivery.
 *
 * Every `emit` is queued and the queue is drained in a microtask, so a handler
 * never runs inside the SDK call that caused it (`to: 'all'` reaches the sender
 * "in a later microtask"), and events reach handlers in the order they were
 * emitted — a `player-join` can never overtake the message that follows it.
 *
 * A throwing handler cannot break the SDK or other handlers: the error is
 * passed to `onHandlerError`.
 */

type Fn = (...args: unknown[]) => void;

export class Emitter {
  private map = new Map<string, Set<Fn>>();
  private queue: Array<[string, unknown[]]> = [];
  private scheduled = false;

  constructor(private onHandlerError: (err: unknown, event: string) => void = () => {}) {}

  on(event: string, fn: Fn): () => void {
    let set = this.map.get(event);
    if (!set) this.map.set(event, (set = new Set()));
    set.add(fn);
    return () => this.off(event, fn);
  }

  off(event: string, fn: Fn): void {
    this.map.get(event)?.delete(fn);
  }

  has(event: string): boolean {
    return (this.map.get(event)?.size ?? 0) > 0;
  }

  emit(event: string, ...args: unknown[]): void {
    this.queue.push([event, args]);
    if (!this.scheduled) {
      this.scheduled = true;
      queueMicrotask(() => this.drain());
    }
  }

  /** Deliver to one listener only, asynchronously (used to replay state to late subscribers). */
  emitTo(fn: Fn, ...args: unknown[]): void {
    queueMicrotask(() => {
      try {
        fn(...args);
      } catch (err) {
        this.onHandlerError(err, "");
      }
    });
  }

  clear(): void {
    this.map.clear();
  }

  private drain(): void {
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
}
