"use client";

/**
 * The playtest harness: the game, a tester HUD, and the report composer.
 *
 * ── LAYOUT ──────────────────────────────────────────────────────────────────
 * A full-height column: a slim top bar, the game filling everything below it,
 * and the composer sliding in over the right-hand side. The game keeps playing
 * while a report is written — losing your position because you paused to
 * describe a bug is exactly how bug reports stop getting written.
 *
 * ── CAPTURE ─────────────────────────────────────────────────────────────────
 * Armed by a button, because `getDisplayMedia` requires a user gesture and there
 * is no silent alternative. One stream feeds the frame grabber. Every grab is
 * cropped to the iframe's rectangle, so the HUD you are reading right now is
 * outside every stored image by construction — see `tab-capture.ts`.
 *
 * ── WHY THE SHOTS ARE ONLY SUGGESTED ────────────────────────────────────────
 * The grabber keeps candidates; the TESTER picks which ones to send. Fully
 * automatic selection reliably picks menus, pause screens and death splashes,
 * because "interesting frame" is not something variance and a hash can judge.
 * Automating the tedious half and leaving the judgement to a human is the whole
 * trick.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import {
  BUG_SEVERITIES,
  MAX_COVER_CANDIDATES,
  REPORT_BODY_MAX,
  REPORT_BODY_MIN,
  REPORT_TITLE_MAX,
  type BugSeverity,
  type ReportKind,
} from "@/app/lib/beta/config";
import {
  acquireTabCapture,
  canCapture,
  FrameGrabber,
  type CaptureFailure,
  type Shot,
} from "@/app/lib/capture/tab-capture";
import {
  finishAssignmentAction,
  submitReportAction,
  submitShotAction,
} from "./actions";

type Game = { slug: string; title: string; externalUrl: string | null };

/** Human copy for each capture refusal. Never shows a raw reason code. */
const CAPTURE_COPY: Record<CaptureFailure, string> = {
  unsupported: "This browser can't record a tab. Everything else still works.",
  denied: "Recording cancelled — you can start it any time.",
  "wrong-surface":
    "Please pick THIS TAB, not a window or your whole screen — we only ever capture the game.",
  "no-track": "Couldn't start recording. Try again?",
};

export function TestSessionClient({
  game,
  brief,
  hasAssignment,
}: {
  game: Game;
  brief: string;
  hasAssignment: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const grabberRef = useRef<FrameGrabber | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [capturing, setCapturing] = useState(false);
  const [captureNote, setCaptureNote] = useState<string | null>(null);
  /**
   * Whether this browser can capture a tab.
   *
   * `canCapture()` reads `navigator`, so it answers false on the server and true
   * in the browser. Calling it inline during render made the button absent from
   * the SSR HTML and present on hydration — a mismatch React recovers from by
   * discarding the tree and re-rendering, which on a page whose main child is a
   * game iframe means REMOUNTING THE GAME.
   *
   * `useSyncExternalStore` with a `() => false` server snapshot is the sanctioned
   * fix: both renders agree on false, then the real value arrives. The repo's
   * `useForceDesktop` in `use-device-platform.ts` uses the identical shape. The
   * subscribe callback is a no-op because capture support cannot change during
   * a session.
   */
  const canRecord = useSyncExternalStore(
    () => () => {},
    () => canCapture(),
    () => false,
  );
  const [shots, setShots] = useState<Shot[]>([]);
  const [sentShots, setSentShots] = useState<Record<string, "sending" | "sent" | "failed">>({});

  const [composerOpen, setComposerOpen] = useState(false);
  const [kind, setKind] = useState<ReportKind>("bug");
  const [severity, setSeverity] = useState<BugSeverity>("minor");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null);

  /** Tear down capture. Safe to call twice. */
  const stopCapture = useCallback(() => {
    grabberRef.current?.stop();
    grabberRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCapturing(false);
  }, []);

  // Stop the stream and release every preview URL when the page goes away —
  // object URLs leak the whole decoded image until revoked.
  useEffect(() => {
    return () => {
      stopCapture();
      setShots((current) => {
        current.forEach((s) => URL.revokeObjectURL(s.previewUrl));
        return [];
      });
    };
  }, [stopCapture]);

  const startCapture = async () => {
    setCaptureNote(null);
    const result = await acquireTabCapture();
    if (!result.ok) {
      setCaptureNote(CAPTURE_COPY[result.reason]);
      return;
    }
    streamRef.current = result.stream;

    // The user can stop sharing from the browser's own bar at any time.
    result.track.addEventListener("ended", () => {
      stopCapture();
      setCaptureNote("Recording stopped.");
    });

    const grabber = new FrameGrabber(result.stream, {
      getTargetRect: () => {
        const el = frameRef.current;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      },
      onShot: (shot) => setShots((current) => [...current, shot]),
      maxShots: MAX_COVER_CANDIDATES,
      intervalMs: 8000,
      maxEdge: 1280,
    });
    grabberRef.current = grabber;
    await grabber.start();
    setCapturing(true);
  };

  const sendShot = async (shot: Shot) => {
    setSentShots((s) => ({ ...s, [shot.id]: "sending" }));
    const fd = new FormData();
    fd.set("slug", game.slug);
    fd.set("file", new File([shot.blob], `${shot.id}.webp`, { type: "image/webp" }));
    const result = await submitShotAction(fd);
    setSentShots((s) => ({ ...s, [shot.id]: result.ok ? "sent" : "failed" }));
    setToast({ ok: result.ok, text: result.ok ? result.message : result.error });
  };

  const submitReport = async () => {
    setBusy(true);
    const result = await submitReportAction({
      slug: game.slug,
      kind,
      severity: kind === "bug" ? severity : null,
      title,
      body,
      device: typeof navigator !== "undefined" ? navigator.userAgent : "",
    });
    setBusy(false);
    setToast({ ok: result.ok, text: result.ok ? result.message : result.error });
    if (result.ok) {
      setTitle("");
      setBody("");
      setComposerOpen(false);
    }
  };

  const finish = async () => {
    const result = await finishAssignmentAction(game.slug);
    setToast({ ok: result.ok, text: result.ok ? result.message : result.error });
  };

  // Auto-clear the toast so it never sits over the game.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const bodyTooShort = body.trim().length < REPORT_BODY_MIN;

  return (
    <div className="flex h-dvh flex-col bg-zinc-950">
      {/* TOP BAR -------------------------------------------------------- */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
        <Link
          href="/beta"
          className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-white/20"
        >
          ← Queue
        </Link>

        <span className="min-w-0 flex-1 truncate text-sm font-black text-white">
          {game.title}
        </span>

        {capturing ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-red-500/20 px-3 py-1.5 text-xs font-black uppercase tracking-wide text-red-300">
            <span className="pip h-2 w-2 rounded-full bg-red-500" />
            Capturing
          </span>
        ) : (
          canRecord && (
            <button
              type="button"
              onClick={startCapture}
              className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-white/20"
            >
              📸 Auto-screenshot
            </button>
          )
        )}

        <button
          type="button"
          onClick={() => {
            setKind("bug");
            setComposerOpen(true);
          }}
          className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-red-600"
        >
          Report bug
        </button>
        <button
          type="button"
          onClick={() => {
            setKind("feature");
            setComposerOpen(true);
          }}
          className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-white/20"
        >
          Idea
        </button>
        {hasAssignment && (
          <button
            type="button"
            onClick={finish}
            className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-emerald-700"
          >
            Done
          </button>
        )}
      </div>

      {brief && (
        <p className="shrink-0 border-b border-white/10 bg-brand/20 px-4 py-2 text-xs font-bold text-white">
          {brief}
        </p>
      )}
      {captureNote && (
        <p className="shrink-0 border-b border-white/10 bg-amber-500/20 px-4 py-2 text-xs font-bold text-amber-100">
          {captureNote}
        </p>
      )}

      {/* GAME + COMPOSER ------------------------------------------------ */}
      <div className="relative flex min-h-0 flex-1">
        {/* The crop target. Everything outside this box — the bar above, the
            composer beside — is excluded from every captured image. */}
        <div ref={frameRef} className="relative min-w-0 flex-1 bg-black">
          <iframe
            key={game.slug}
            // Trailing slash is load-bearing for bundled games: it makes their
            // relative asset URLs (./main.js) resolve under the folder.
            src={game.externalUrl ?? `/game-html/${game.slug}/`}
            title={game.title}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; fullscreen; gamepad; pointer-lock"
            allowFullScreen
          />
        </div>

        {composerOpen && (
          <div className="absolute inset-y-0 right-0 z-10 w-full max-w-sm overflow-y-auto border-l border-border bg-surface p-4 shadow-2xl sm:relative sm:shadow-none">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
                {kind === "bug" ? "Report a bug" : "Suggest an idea"}
              </h2>
              <button
                type="button"
                onClick={() => setComposerOpen(false)}
                aria-label="Close"
                className="rounded-full px-2 py-1 text-sm font-black text-muted hover:bg-surface-2"
              >
                ✕
              </button>
            </div>

            {kind === "bug" && (
              <label className="mt-4 block text-[11px] font-black uppercase tracking-wide text-muted">
                How bad is it?
                <select
                  value={severity}
                  onChange={(e) => setSeverity(e.target.value as BugSeverity)}
                  className="mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm font-semibold text-zinc-900 outline-none focus:ring-2 focus:ring-brand/30"
                >
                  {BUG_SEVERITIES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-muted">
              Title
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={REPORT_TITLE_MAX}
                placeholder={
                  kind === "bug" ? "Score resets when you pause" : "Let me remap the keys"
                }
                className="mt-1 w-full rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>

            <label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-muted">
              What happened?
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                maxLength={REPORT_BODY_MAX}
                rows={5}
                placeholder="What did you do, and what went wrong? Steps to make it happen again are gold."
                className="mt-1 w-full resize-y rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>
            <p className="mt-1 text-[11px] font-semibold text-muted">
              {bodyTooShort
                ? `${REPORT_BODY_MIN - body.trim().length} more characters`
                : `${REPORT_BODY_MAX - body.length} left`}
            </p>

            <button
              type="button"
              onClick={submitReport}
              disabled={busy || !title.trim() || bodyTooShort}
              className="mt-4 w-full rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send report"}
            </button>
          </div>
        )}
      </div>

      {/* FILMSTRIP ------------------------------------------------------ */}
      {shots.length > 0 && (
        <div className="shrink-0 border-t border-white/10 px-3 py-2">
          <p className="mb-1.5 text-[11px] font-black uppercase tracking-wide text-white/60">
            Screenshots — pick the good ones for the game&rsquo;s page
          </p>
          <ul className="flex gap-2 overflow-x-auto pb-1">
            {shots.map((shot) => {
              const state = sentShots[shot.id];
              return (
                <li key={shot.id} className="relative shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={shot.previewUrl}
                    alt=""
                    className="h-20 w-auto rounded-lg border border-white/20"
                  />
                  <button
                    type="button"
                    onClick={() => sendShot(shot)}
                    disabled={state === "sending" || state === "sent"}
                    className="absolute inset-x-1 bottom-1 rounded-full bg-black/70 px-2 py-1 text-[10px] font-black text-white backdrop-blur transition hover:bg-black/90 disabled:opacity-70"
                  >
                    {state === "sent"
                      ? "✓ Sent"
                      : state === "sending"
                        ? "…"
                        : state === "failed"
                          ? "Retry"
                          : "Use this"}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {toast && (
        <div
          aria-live="polite"
          className={`pointer-events-none fixed inset-x-0 bottom-4 z-50 flex justify-center px-4`}
        >
          <span
            className={`rounded-full px-4 py-2 text-sm font-extrabold text-white shadow-xl ${
              toast.ok ? "bg-emerald-600" : "bg-red-600"
            }`}
          >
            {toast.text}
          </span>
        </div>
      )}
    </div>
  );
}
