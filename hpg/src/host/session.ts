/**
 * One running game: its sandboxed frame, its message channel and its teardown.
 *
 * THE FRAME. `sandbox="allow-scripts"` (+ `allow-pointer-lock` when the
 * manifest asks), loaded through `srcdoc`. Without `allow-same-origin` the frame
 * runs in an opaque origin: it cannot reach this page's DOM, storage or
 * functions (the spike verified that `parent.document` throws). Without
 * `allow-popups`, `allow-top-navigation` or `allow-forms`, it cannot open
 * windows, navigate the launcher away, or submit forms that reload it. The
 * `sandbox` attribute is never widened at run time.
 *
 * THE CHANNEL. A message is acted on only when ALL of these hold:
 *   - `event.source` is THIS session's frame window (not a previous one, and
 *     not some other window);
 *   - `event.origin === "null"`, as an opaque-origin frame always reports;
 *   - it parses as a protocol message of this session (protocol/messages.ts).
 *
 * TEARDOWN ({@link GameSession.close}): ask the game to FLUSH its save, wait
 * briefly for it, then remove the message listener and the frame and clear
 * every timer. Close is idempotent, and nothing it registered outlives it.
 * The tests count listeners and timers to keep it that way.
 */

import type { LoadedPackage } from "../archive/package";
import type { GuestConfig } from "../guest/install";
import {
  envelope,
  parseGuestMessage,
  type HostMessage,
  type SaveData,
  type ScoreEntry,
} from "../protocol/messages";
import { buildGameDocument, guestFilesOf } from "./document";

export type SessionCallbacks = {
  onReady?(): void;
  onExit?(): void;
  /** A message from inside the game; plain text, safe to show in a details line. */
  onError?(message: string): void;
  onSave(data: SaveData): void | Promise<void>;
  onScore(score: number, handle: string | undefined): Promise<number>;
  onScoresRequest(limit: number): Promise<ScoreEntry[]>;
  onLoadRequest(): Promise<SaveData | null>;
  /** The game sent no GAME_READY within the start timeout. */
  onSlowStart?(): void;
};

export type SessionOptions = {
  container: HTMLElement;
  pkg: LoadedPackage;
  save: SaveData | null;
  muted: boolean;
  handle: string | null;
  runtimeJs: string;
  callbacks: SessionCallbacks;
  win?: Window;
  /** Overridable for tests. */
  newSessionId?: () => string;
  startTimeoutMs?: number;
  flushTimeoutMs?: number;
};

const SAVE_COALESCE_MS = 500;

export function randomSessionId(): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function sandboxFor(pkg: LoadedPackage): string {
  const tokens = ["allow-scripts"];
  if (pkg.manifest.permissions.includes("pointer-lock")) tokens.push("allow-pointer-lock");
  return tokens.join(" ");
}

export class GameSession {
  readonly sessionId: string;
  private frame: HTMLIFrameElement | null = null;
  private closed = false;
  private readonly win: Window;
  private readonly timers = new Set<ReturnType<typeof setTimeout>>();
  private pendingSave: SaveData | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private flushWaiter: (() => void) | null = null;
  private ready = false;

  constructor(private opts: SessionOptions) {
    this.win = opts.win ?? window;
    this.sessionId = (opts.newSessionId ?? randomSessionId)();
  }

  get iframe(): HTMLIFrameElement | null {
    return this.frame;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  start(): HTMLIFrameElement {
    if (this.closed) throw new Error("session is closed");
    if (this.frame) return this.frame;
    const { pkg, save, muted, handle, runtimeJs } = this.opts;
    const { files, classicWorkers } = guestFilesOf(pkg);
    const config: GuestConfig = {
      session: this.sessionId,
      gameId: pkg.manifest.id,
      storage: save?.storage ?? {},
      custom: save?.custom,
      files,
      classicWorkers,
      muted,
      handle,
    };
    const entry = new TextDecoder().decode(pkg.files.get(pkg.manifest.entry)!);
    const doc = this.win.document;
    const frame = doc.createElement("iframe");
    frame.setAttribute("sandbox", sandboxFor(pkg));
    frame.setAttribute("allow", "autoplay; gamepad");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", pkg.manifest.name);
    frame.className = "game-frame";
    this.win.addEventListener("message", this.onMessage);
    frame.srcdoc = buildGameDocument(entry, config, runtimeJs, new (this.win as unknown as typeof globalThis).DOMParser());
    this.opts.container.appendChild(frame);
    this.frame = frame;
    this.later(() => {
      if (!this.ready && !this.closed) this.opts.callbacks.onSlowStart?.();
    }, this.opts.startTimeoutMs ?? 15000);
    return frame;
  }

  focus(): void {
    this.frame?.focus();
    try {
      this.frame?.contentWindow?.focus();
    } catch {
      /* cross-origin focus is allowed; ignore any engine that disagrees */
    }
  }

  pause(): void {
    this.post({ type: "PAUSE" });
  }
  resume(): void {
    this.post({ type: "RESUME" });
  }
  setMuted(muted: boolean): void {
    this.post({ type: "MUTE", payload: { muted } });
  }

  /** Flush the game's save, then tear everything down. Safe to call twice. */
  async close(): Promise<void> {
    if (this.closed) return;
    if (this.frame) {
      await new Promise<void>((res) => {
        this.flushWaiter = res;
        this.post({ type: "FLUSH" });
        this.later(res, this.opts.flushTimeoutMs ?? 400);
      });
      this.flushWaiter = null;
    }
    this.closed = true;
    await this.writePendingSave();
    this.win.removeEventListener("message", this.onMessage);
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.frame) {
      this.frame.srcdoc = "";
      this.frame.remove();
      this.frame = null;
    }
  }

  private later(fn: () => void, ms: number) {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, ms);
    this.timers.add(t);
    return t;
  }

  private post(msg: HostMessage): void {
    const target = this.frame?.contentWindow;
    if (!target || this.closed) return;
    // The frame's origin is opaque, so "*" is the only possible target origin.
    target.postMessage(envelope(this.sessionId, msg), "*");
  }

  private async writePendingSave(): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.timers.delete(this.saveTimer);
      this.saveTimer = null;
    }
    const data = this.pendingSave;
    this.pendingSave = null;
    if (data) {
      try {
        await this.opts.callbacks.onSave(data);
      } catch (e) {
        this.opts.callbacks.onError?.(`Saving failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }

  private onMessage = (event: MessageEvent): void => {
    if (this.closed || !this.frame || event.source !== this.frame.contentWindow) return;
    if (event.origin !== "null") return;
    const msg = parseGuestMessage(event.data, this.sessionId);
    if (!msg) return;
    const cb = this.opts.callbacks;
    switch (msg.type) {
      case "GAME_READY":
        if (!this.ready) {
          this.ready = true;
          cb.onReady?.();
        }
        return;
      case "GAME_EXIT":
        cb.onExit?.();
        return;
      case "GAME_ERROR":
        cb.onError?.(msg.payload.message);
        return;
      case "SAVE_REQUEST":
        // Coalesce: a game writing localStorage every frame costs one write per 500 ms.
        this.pendingSave = msg.payload;
        if (this.flushWaiter) {
          void this.writePendingSave().then(() => this.flushWaiter?.());
        } else if (this.saveTimer === null) {
          this.saveTimer = this.later(() => {
            this.saveTimer = null;
            void this.writePendingSave();
          }, SAVE_COALESCE_MS);
        }
        return;
      case "LOAD_REQUEST":
        void cb.onLoadRequest().then((save) => this.post({ type: "REPLY", id: msg.id, payload: save ?? null }));
        return;
      case "SCORE_SUBMIT":
        void cb.onScore(msg.payload.score, msg.payload.handle).then(
          (rank) => this.post({ type: "REPLY", id: msg.id, payload: { ok: true, rank } }),
          () => this.post({ type: "REPLY", id: msg.id, payload: { ok: false } }),
        );
        return;
      case "SCORES_REQUEST":
        void cb.onScoresRequest(msg.payload.limit).then(
          (scores) => this.post({ type: "REPLY", id: msg.id, payload: scores.slice(0, msg.payload.limit) }),
          () => this.post({ type: "REPLY", id: msg.id, payload: [] }),
        );
        return;
    }
  };
}
