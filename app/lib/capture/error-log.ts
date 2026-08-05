/**
 * HallPass — the session error log.
 *
 * Collects the JavaScript errors a game throws while a beta tester plays, so a
 * report can carry the stack trace instead of asking a child to find one.
 *
 * WHY THIS IS WORTH MORE THAN ANY AMOUNT OF PROSE. When a game breaks, the
 * exception is frequently the entire answer — the file, the line, the undefined
 * property. No tester will ever open devtools and paste it, and asking them to
 * would be asking the wrong person. Collecting it silently costs them nothing
 * and turns "it just stopped" into a diagnosis.
 *
 * ── WHAT CAN AND CANNOT BE INSTRUMENTED ─────────────────────────────────────
 * SELF-HOSTED games load from `/game-html/<slug>/`, which is OUR origin, so the
 * parent can reach `iframe.contentWindow` and listen on it directly.
 *
 * EXTERNAL games are cross-origin. `contentWindow` exists but every property
 * access throws, and `window.onerror` in the parent receives only the opaque
 * "Script error." with no file, line or stack — that is the same-origin policy
 * working as intended, not a bug to route around. {@link attachToFrame} reports
 * which case it got so the UI can say so plainly rather than implying it is
 * watching when it is not.
 *
 * ── THE BUFFER IS BOUNDED, IN THREE DIMENSIONS ──────────────────────────────
 * A game stuck in a broken render loop can throw the same error sixty times a
 * second. The log caps the number of entries, the length of each message and
 * stack, AND collapses consecutive duplicates into a count — without all three,
 * a single runaway game would exhaust memory and then post a multi-megabyte
 * report body.
 */

/** One captured failure, already normalised and truncated. */
export type CapturedError = {
  /** Milliseconds since the log was created — relative, so no clock is needed. */
  at: number;
  /** Whether it came from the page around the game, or from the game itself. */
  source: "page" | "game";
  kind: "error" | "rejection" | "resource";
  message: string;
  stack?: string;
  file?: string;
  line?: number;
  /** How many times in a row this same error repeated. `1` for a one-off. */
  count: number;
};

/** Hard caps. A runaway game must not be able to grow any of these. */
export const MAX_ENTRIES = 25;
export const MAX_MESSAGE_CHARS = 300;
export const MAX_STACK_CHARS = 1200;

/**
 * Is this Error-shaped?
 *
 * DUCK-TYPED, NOT `instanceof`, and that is the whole point. A game throws
 * inside the IFRAME'S JavaScript realm, which has its own `Error` constructor —
 * so `err instanceof Error` in the parent page is FALSE for every real game
 * error. The check silently fell through to `JSON.stringify`, and an Error
 * serialises to `{}`, so every captured stack arrived labelled "{}". It looked
 * like it worked right up until a real game threw.
 *
 * A string `message` is the only signal that survives a realm boundary.
 */
function isErrorLike(
  value: unknown,
): value is { name?: unknown; message: string; stack?: unknown } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { message?: unknown }).message === "string"
  );
}

/** Trim and flatten a value that may be anything a game chose to throw. */
export function normaliseMessage(value: unknown): string {
  if (value == null) return "(no message)";
  const text =
    typeof value === "string"
      ? value
      : isErrorLike(value)
        ? `${typeof value.name === "string" && value.name ? value.name : "Error"}: ${value.message}`
        : (() => {
            try {
              return JSON.stringify(value) ?? String(value);
            } catch {
              // Circular, or a Proxy that throws on access. `String()` can also
              // throw for an object with a hostile toString, hence the outer
              // guard in the caller.
              return String(value);
            }
          })();
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > MAX_MESSAGE_CHARS
    ? `${flat.slice(0, MAX_MESSAGE_CHARS)}…`
    : flat || "(no message)";
}

/** Keep a stack readable and bounded. */
export function normaliseStack(stack: unknown): string | undefined {
  if (typeof stack !== "string" || !stack.trim()) return undefined;
  return stack.length > MAX_STACK_CHARS
    ? `${stack.slice(0, MAX_STACK_CHARS)}…`
    : stack;
}

/**
 * Strip the origin from a script URL.
 *
 * `http://localhost:3001/game-html/pixel-slicer/main.js` reads as
 * `/game-html/pixel-slicer/main.js`. The host is noise — it is always this site
 * or an embedded game's — and keeping it would make reports from a preview
 * deployment look different from identical ones filed on production.
 */
export function shortenFile(file: unknown): string | undefined {
  if (typeof file !== "string" || !file) return undefined;
  try {
    return new URL(file).pathname;
  } catch {
    return file.length > 120 ? `…${file.slice(-120)}` : file;
  }
}

/**
 * A bounded, de-duplicating ring buffer of captured errors.
 *
 * Pure and DOM-free so it can be unit-tested; {@link attachErrorCapture} wires
 * the browser events into it.
 */
export class ErrorLog {
  private readonly entries: CapturedError[] = [];
  private readonly startedAt: number;

  constructor(now: number) {
    this.startedAt = now;
  }

  /**
   * Record one failure.
   *
   * Consecutive identical errors increment a count rather than appending, which
   * is what makes a broken render loop survivable: sixty throws a second become
   * one entry with `count: 3600`, and the rest of the buffer keeps its history
   * instead of being flushed out by the repeat.
   */
  push(
    entry: Omit<CapturedError, "at" | "count"> & { at?: number },
    now: number,
  ): void {
    const last = this.entries[this.entries.length - 1];
    if (
      last &&
      last.message === entry.message &&
      last.source === entry.source &&
      last.kind === entry.kind &&
      last.line === entry.line
    ) {
      last.count += 1;
      return;
    }

    this.entries.push({
      ...entry,
      at: Math.max(0, Math.round((entry.at ?? now) - this.startedAt)),
      count: 1,
    });

    // Drop the OLDEST when full. The first error in a cascade is usually the
    // real one, but a report filed twenty minutes later is about what just
    // happened — recency wins, and the count field preserves the fact that the
    // dropped ones repeated.
    while (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  /** A copy, oldest first. */
  snapshot(): CapturedError[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  get size(): number {
    return this.entries.length;
  }

  clear(): void {
    this.entries.length = 0;
  }
}

/** What {@link attachToFrame} managed to do. */
export type FrameAttachResult = "attached" | "cross-origin" | "unavailable";

/**
 * Listen for failures on one window (the page, or a same-origin game frame).
 *
 * Returns a detach function. Uses `addEventListener` rather than assigning
 * `window.onerror`, so a game that sets its own handler is not clobbered and
 * ours is not clobbered by it.
 */
export function attachErrorCapture(
  target: Window,
  log: ErrorLog,
  source: CapturedError["source"],
): () => void {
  const onError = (event: ErrorEvent) => {
    log.push(
      {
        source,
        kind: "error",
        message: normaliseMessage(event.error ?? event.message),
        stack: normaliseStack(
          (event.error as Error | undefined)?.stack,
        ),
        file: shortenFile(event.filename),
        line: typeof event.lineno === "number" ? event.lineno : undefined,
      },
      Date.now(),
    );
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    const reason = event.reason as unknown;
    log.push(
      {
        source,
        kind: "rejection",
        message: normaliseMessage(reason),
        stack: normaliseStack((reason as Error | undefined)?.stack),
      },
      Date.now(),
    );
  };

  /**
   * A failed image/script/audio load.
   *
   * These do NOT bubble, so the listener must be registered in the CAPTURE
   * phase on the window — the usual mistake is a bubble-phase listener that
   * silently never fires. A missing asset is one of the most common "the game
   * doesn't load" causes and the filename is the whole diagnosis.
   */
  const onResourceError = (event: Event) => {
    const el = event.target as HTMLElement | null;
    if (!el || el === (target as unknown as HTMLElement)) return;
    const tag = el.tagName?.toLowerCase();
    if (!tag || !["img", "script", "link", "audio", "video", "source"].includes(tag)) {
      return;
    }
    const url =
      (el as HTMLImageElement).src ||
      (el as HTMLLinkElement).href ||
      "";
    if (!url) return;
    log.push(
      {
        source,
        kind: "resource",
        message: `Failed to load <${tag}>`,
        file: shortenFile(url),
      },
      Date.now(),
    );
  };

  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection as EventListener);
  target.addEventListener("error", onResourceError, true);

  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection as EventListener);
    target.removeEventListener("error", onResourceError, true);
  };
}

/**
 * Try to instrument a game iframe.
 *
 * Accessing `contentWindow` on a cross-origin frame throws a SecurityError, so
 * the probe is wrapped — and a failure is reported as `cross-origin` rather than
 * swallowed, because the UI must be able to tell a tester that errors from THIS
 * game cannot be collected. Claiming to watch and silently not watching is worse
 * than not offering it.
 */
export function attachToFrame(
  frame: HTMLIFrameElement,
  log: ErrorLog,
): { result: FrameAttachResult; detach: () => void } {
  const noop = () => {};
  let win: Window | null = null;
  try {
    win = frame.contentWindow;
    // Touching a property is what actually trips the security check; merely
    // reading `contentWindow` does not.
    void win?.location.href;
  } catch {
    return { result: "cross-origin", detach: noop };
  }
  if (!win) return { result: "unavailable", detach: noop };
  return { result: "attached", detach: attachErrorCapture(win, log, "game") };
}
