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
  attachToFrame,
  ErrorLog,
  attachErrorCapture,
  type CapturedError,
  type FrameAttachResult,
} from "@/app/lib/capture/error-log";
import {
  // Aliased: `canRecord` in this file already means "can capture a tab at all".
  // This one is narrower — whether MediaRecorder can encode that tab's video.
  canRecord as canRecordVideo,
  extensionFor,
  ReplayBuffer,
  type ReplayClip,
} from "@/app/lib/capture/replay-buffer";
import { upload } from "@vercel/blob/client";
import { SessionTutorial, tutorialSeen } from "./SessionTutorial";
import {
  finishAssignmentAction,
  submitReportAction,
  submitShotAction,
} from "./actions";

/**
 * The shortcut that stops the session and opens a bug report.
 *
 * Ctrl/Cmd+Shift+B rather than a bare key: the iframe below has focus for most
 * of a session and games bind letters, digits, arrows and space. A three-key
 * combination is one nothing in the catalogue uses, and the modifier means a
 * stray press while typing in the composer cannot fire it either.
 *
 * The handler is registered in the CAPTURE phase on `window` so it runs before
 * the page's own handlers. It cannot reach INSIDE the iframe — a cross-origin
 * game swallows every key it receives — which is why the shortcut is also a
 * visible button.
 */
const BUG_SHORTCUT_LABEL = "Ctrl/⌘ + Shift + B";

function isBugShortcut(event: KeyboardEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    event.shiftKey &&
    (event.key === "B" || event.key === "b")
  );
}

type Game = { slug: string; title: string; externalUrl: string | null };

/** Human copy for each capture refusal. Never shows a raw reason code. */
const CAPTURE_COPY: Record<CaptureFailure, string> = {
  unsupported: "This browser can't record a tab. Everything else still works.",
  denied: "Recording cancelled — you can start it any time.",
  "wrong-surface":
    "Please pick THIS TAB, not a window or your whole screen — we only ever capture the game.",
  "no-track": "Couldn't start recording. Try again?",
};

/**
 * What to tell a tester when the reviews endpoint refuses without saying why.
 *
 * WHY THIS EXISTS AT ALL. `POST /api/v1/games/<slug>/reviews` answers a rejected
 * write in two different shapes: the validation and rate-limit paths send
 * `{ reason }`, but the two GUARD paths — `unauthorized()` and `forbidden()` —
 * send `{ error }` and are deliberately vague, because naming the referrer rule
 * would tell an embedded game exactly what to spoof.
 *
 * The composer only ever read `reason`, so every guard rejection collapsed into
 * one unactionable string. When `/beta/` was missing from the referrer allowlist
 * that string was the ENTIRE diagnostic available to the tester, the report they
 * filed, and the admin triaging it. Nobody could get past "reviews are broken".
 *
 * So: fall back on the status code, and put the number in the sentence. It is
 * mild noise for a child, and it turns the next occurrence of this class of bug
 * into a one-line report instead of an investigation.
 */
function reviewFailureMessage(status: number): string {
  if (status === 401) return "You've been signed out — sign in again to post this.";
  if (status === 403) {
    // Not the tester's fault and not fixable by them: this is a server-side
    // guard refusing the page itself, so say so rather than implying they typed
    // something wrong.
    return "This screen isn't allowed to post reviews right now — please report this (403).";
  }
  if (status === 404) return "This game isn't in the catalogue any more.";
  if (status === 503) return "Reviews aren't switched on yet.";
  return `Could not post that (error ${status}).`;
}

export function TestSessionClient({
  game,
  brief,
  hasAssignment,
  initiallyReviewed,
  playerId,
}: {
  game: Game;
  brief: string;
  hasAssignment: boolean;
  /** Keys the tutorial's "seen" flag, so a shared computer stays per-person. */
  playerId: string;
  /** Whether this tester has already reviewed the game, resolved on the server. */
  initiallyReviewed: boolean;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const grabberRef = useRef<FrameGrabber | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const replayRef = useRef<ReplayBuffer | null>(null);
  /**
   * The error log outlives every re-render and is never state.
   *
   * Putting it in `useState` would re-render the whole session — remounting
   * nothing, but re-running the tree — every time a broken game throws, which
   * for a game stuck in a bad render loop is sixty times a second.
   */
  const errorLogRef = useRef<ErrorLog | null>(null);

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

  /** Which captured still is pinned to the report being written, if any. */
  const [attachedId, setAttachedId] = useState<string | null>(null);

  /**
   * The first-run walkthrough.
   *
   * Starts closed and is opened from an effect rather than initialised from
   * `localStorage`, which does not exist on the server — reading it during
   * render is the same hydration mismatch that cost the capture button a
   * remount of the game.
   */
  const [tutorialOpen, setTutorialOpen] = useState(false);
  useEffect(() => {
    if (!tutorialSeen(playerId)) setTutorialOpen(true);
  }, [playerId]);

  /** Whether the game's own errors can be seen — false for cross-origin games. */
  const [errorWatch, setErrorWatch] = useState<FrameAttachResult | null>(null);
  /** Snapshotted at the moment the shortcut fires, so it cannot drift. */
  const [pendingErrors, setPendingErrors] = useState<CapturedError[]>([]);
  /** The replay flushed for the report being written. */
  const [pendingClip, setPendingClip] = useState<ReplayClip | null>(null);
  const [clipState, setClipState] = useState<"idle" | "flushing" | "ready">("idle");
  /**
   * A still of the moment the shortcut fired, painted over the game.
   *
   * An arbitrary game cannot actually be paused — it owns its own loop and most
   * of the catalogue is cross-origin, so there is no handle to pull. What CAN be
   * done is stop the tester losing the moment: freeze what they saw, over the
   * top, while they write. The game keeps running underneath, which is honest
   * and does not pretend otherwise.
   */
  const [freezeFrame, setFreezeFrame] = useState<string | null>(null);

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewed, setReviewed] = useState(initiallyReviewed);
  const [recommended, setRecommended] = useState<boolean | null>(null);
  const [reviewBody, setReviewBody] = useState("");

  /**
   * Start collecting errors as soon as the session opens — before, and
   * independently of, any recording.
   *
   * This needs no permission and no user gesture, so it is the one piece of
   * evidence gathering that is always on. A tester who never presses the
   * capture button still files reports carrying the game's stack traces.
   */
  useEffect(() => {
    const log = new ErrorLog(Date.now());
    errorLogRef.current = log;
    const detachPage = attachErrorCapture(window, log, "page");

    // The frame's own errors need a listener INSIDE it, which is only reachable
    // for self-hosted games. `attachToFrame` reports which case this is so the
    // HUD can say so instead of implying it is watching when it cannot.
    let detachFrame = () => {};
    const wire = () => {
      const frame = iframeRef.current;
      if (!frame) return;
      detachFrame();
      const { result, detach } = attachToFrame(frame, log);
      detachFrame = detach;
      setErrorWatch(result);
    };

    const frame = iframeRef.current;
    frame?.addEventListener("load", wire);
    // Already loaded from cache — `load` will not fire again.
    wire();

    return () => {
      detachPage();
      detachFrame();
      frame?.removeEventListener("load", wire);
      errorLogRef.current = null;
    };
  }, []);

  /** Tear down capture. Safe to call twice. */
  const stopCapture = useCallback(() => {
    grabberRef.current?.stop();
    grabberRef.current = null;
    replayRef.current?.stop();
    replayRef.current = null;
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

    // The same stream feeds the replay buffer — one permission prompt, two
    // consumers. A browser that cannot record simply gets screenshots.
    if (canRecordVideo()) {
      const replay = new ReplayBuffer(result.stream);
      replay.start();
      replayRef.current = replay;
    }

    setCapturing(true);
  };

  /**
   * Stop the session and open a bug report with the evidence already gathered.
   *
   * Order matters. The freeze-frame and the error snapshot are taken FIRST and
   * synchronously, because both describe "the moment" and both keep changing —
   * a game throws more errors and paints more frames while an await resolves.
   * The replay flush is slow (it finalises a recording) so it runs after, and
   * the composer opens without waiting for it.
   */
  const openBugReport = useCallback(async () => {
    setKind("bug");
    setComposerOpen(true);
    setReviewOpen(false);

    // Snapshot the errors as they are right now.
    setPendingErrors(errorLogRef.current?.snapshot() ?? []);

    // Freeze the most recent grab over the game, so the tester can look at what
    // happened while they describe it.
    const latest = shots[shots.length - 1];
    if (latest) setFreezeFrame(latest.previewUrl);

    // Best-effort pause request. A same-origin game that listens for it can
    // honour it; a cross-origin one never receives it, and nothing depends on
    // either outcome.
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "hallpass:pause" },
        "*",
      );
    } catch {
      /* cross-origin, as expected for most of the catalogue */
    }

    const replay = replayRef.current;
    if (!replay) return;
    setClipState("flushing");
    try {
      const clip = await replay.flush();
      setPendingClip(clip);
      setClipState(clip ? "ready" : "idle");
    } catch {
      setClipState("idle");
    }
  }, [shots]);

  // The shortcut. Capture phase on `window` so it beats the page's own
  // handlers; it cannot reach inside a cross-origin iframe, which is why the
  // HUD also carries a button.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isBugShortcut(event)) return;
      event.preventDefault();
      void openBugReport();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [openBugReport]);

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

    // The picked still travels as FormData — a Server Action can carry a File
    // there but not inside a plain serialised object.
    let shot: FormData | undefined;
    const attached = shots.find((s) => s.id === attachedId);
    if (attached) {
      shot = new FormData();
      shot.set(
        "file",
        new File([attached.blob], `${attached.id}.webp`, { type: "image/webp" }),
      );
    }

    // Upload the replay STRAIGHT TO BLOB from here, not through the action: a
    // 30-second clip is 3-6 MB and a Server Action's request body is capped at
    // 4.5 MB by the platform. See `api/v1/beta/clip-token`.
    //
    // A failed clip upload must not cost the report. The words are the point;
    // the video is supporting material, and losing what a tester typed because
    // a blob PUT timed out would be the worst possible trade.
    let clipBlobPath: string | null = null;
    let clipUrl: string | null = null;
    let clipBytes = 0;
    let clipMs = 0;
    if (pendingClip) {
      try {
        const ext = extensionFor(pendingClip.mimeType);
        const name = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
        const path = `beta-clips/${game.slug}/${name}.${ext}`;
        const uploaded = await upload(path, pendingClip.blob, {
          access: "public",
          handleUploadUrl: "/api/v1/beta/clip-token",
          contentType: pendingClip.mimeType || undefined,
        });
        clipBlobPath = uploaded.pathname;
        clipUrl = uploaded.url;
        clipBytes = pendingClip.blob.size;
        clipMs = pendingClip.durationMs;
      } catch (error) {
        console.error("replay upload failed:", error);
        setToast({ ok: false, text: "Clip didn't upload — sending the report anyway" });
      }
    }

    const result = await submitReportAction(
      {
        slug: game.slug,
        kind,
        severity: kind === "bug" ? severity : null,
        title,
        body,
        device: typeof navigator !== "undefined" ? navigator.userAgent : "",
        clipBlobPath,
        clipUrl,
        clipBytes,
        clipMs,
        errorLog: pendingErrors.length ? JSON.stringify(pendingErrors) : null,
        errorCount: pendingErrors.length,
      },
      shot,
    );
    setBusy(false);
    setToast({ ok: result.ok, text: result.ok ? result.message : result.error });
    if (result.ok) {
      setTitle("");
      setBody("");
      setAttachedId(null);
      setComposerOpen(false);
      setPendingClip(null);
      setPendingErrors([]);
      setClipState("idle");
      setFreezeFrame(null);
    }
  };

  const finish = async () => {
    const result = await finishAssignmentAction(game.slug);
    setToast({ ok: result.ok, text: result.ok ? result.message : result.error });
    // The action refuses without a review; open the composer rather than leaving
    // the tester to work out what to do about the message.
    if (!result.ok) setReviewOpen(true);
  };

  /**
   * Post the required review.
   *
   * Uses the SAME `/api/v1/games/<slug>/reviews` endpoint the public
   * `ReviewComposer` posts to, so a tester's review is an ordinary review — it
   * appears on the game page, it is moderated by the same rules, and it counts
   * towards the recommend ratio. A separate "tester review" would be a second
   * kind of review to display, moderate and reason about, for no gain.
   */
  const submitReview = async () => {
    if (recommended === null) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/v1/games/${encodeURIComponent(game.slug)}/reviews`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ recommended, body: reviewBody }),
        },
      );
      // `.catch` because a guard response can be bodyless, and an unparseable
      // body must not fall through to the outer catch — that reports "you appear
      // to be offline" to somebody who is plainly online, which is worse than no
      // message at all.
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
      };
      if (data.ok) {
        setReviewed(true);
        setReviewOpen(false);
        setToast({ ok: true, text: "Review posted — you can finish now" });
      } else {
        setToast({
          ok: false,
          text: data.reason ?? reviewFailureMessage(res.status),
        });
      }
    } catch {
      setToast({ ok: false, text: "You appear to be offline." });
    } finally {
      setBusy(false);
    }
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

        <button
          type="button"
          onClick={() => setTutorialOpen(true)}
          aria-label="How this screen works"
          title="How this screen works"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/10 text-xs font-black text-white transition hover:bg-white/20"
        >
          ?
        </button>

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
          onClick={() => void openBugReport()}
          title={`Shortcut: ${BUG_SHORTCUT_LABEL}`}
          className="rounded-full bg-red-500 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-red-600"
        >
          Report bug
          <span className="ml-1.5 hidden font-bold opacity-70 sm:inline">
            {BUG_SHORTCUT_LABEL}
          </span>
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
          <>
            {/* The review is REQUIRED to finish, so it gets its own control
                rather than hiding behind a rejected "Done". */}
            <button
              type="button"
              onClick={() => setReviewOpen(true)}
              className={`rounded-full px-3 py-1.5 text-xs font-extrabold transition ${
                reviewed
                  ? "bg-white/10 text-white hover:bg-white/20"
                  : "bg-accent-yellow text-zinc-900 hover:brightness-95"
              }`}
            >
              {reviewed ? "✓ Reviewed" : "★ Review (required)"}
            </button>
            <button
              type="button"
              onClick={finish}
              disabled={!reviewed}
              title={reviewed ? undefined : "Write your review first"}
              className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-extrabold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Done
            </button>
          </>
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
            ref={iframeRef}
            key={game.slug}
            // Trailing slash is load-bearing for bundled games: it makes their
            // relative asset URLs (./main.js) resolve under the folder.
            src={game.externalUrl ?? `/game-html/${game.slug}/`}
            title={game.title}
            className="absolute inset-0 h-full w-full border-0"
            allow="autoplay; fullscreen; gamepad; pointer-lock"
            allowFullScreen
          />

          {/* The frozen moment, painted over the running game. It is inside the
              crop target, so a grab taken while it is up would capture the
              freeze rather than the game — which is why the grabber is the thing
              that produced it and no new grabs are needed while reporting. */}
          {freezeFrame && (
            <div className="absolute inset-0 z-10 bg-black">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={freezeFrame}
                alt="The moment you reported"
                className="h-full w-full object-contain"
              />
              <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-black/70 px-3 py-2 backdrop-blur">
                <span className="text-xs font-black uppercase tracking-wide text-white">
                  ⏸ Frozen at the bug
                </span>
                <button
                  type="button"
                  onClick={() => setFreezeFrame(null)}
                  className="rounded-full bg-white/20 px-3 py-1 text-xs font-extrabold text-white transition hover:bg-white/30"
                >
                  Back to the game
                </button>
              </div>
            </div>
          )}
        </div>

        {reviewOpen && (
          <div className="absolute inset-y-0 right-0 z-20 w-full max-w-sm overflow-y-auto border-l border-border bg-surface p-4 shadow-2xl sm:relative sm:shadow-none">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-black uppercase tracking-wide text-zinc-900">
                Your review
              </h2>
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                aria-label="Close"
                className="rounded-full px-2 py-1 text-sm font-black text-muted hover:bg-surface-2"
              >
                ✕
              </button>
            </div>
            <p className="mt-2 text-xs font-semibold text-muted">
              This one is required — it&rsquo;s the verdict the playtest is for,
              and it appears on the game&rsquo;s page like any other review.
            </p>

            <div className="mt-4 flex gap-2">
              {/* Matches the public composer's thumbs choice, so a tester sees
                  the same question everyone else answers. */}
              {[
                { value: true, label: "👍 Recommend" },
                { value: false, label: "👎 Not really" },
              ].map((option) => (
                <button
                  key={String(option.value)}
                  type="button"
                  onClick={() => setRecommended(option.value)}
                  className={`flex-1 rounded-full border px-3 py-2 text-xs font-extrabold transition ${
                    recommended === option.value
                      ? "border-brand bg-brand-50 text-brand"
                      : "border-border bg-white text-zinc-700 hover:bg-surface-2"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <label className="mt-3 block text-[11px] font-black uppercase tracking-wide text-muted">
              What did you think?
              <textarea
                value={reviewBody}
                onChange={(e) => setReviewBody(e.target.value)}
                rows={5}
                maxLength={500}
                placeholder="Is it fun? Does it control well? Would you play it again?"
                className="mt-1 w-full resize-y rounded-lg border border-border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-brand/30"
              />
            </label>

            <button
              type="button"
              onClick={submitReview}
              disabled={busy || recommended === null || reviewBody.trim().length < 2}
              className="mt-4 w-full rounded-full bg-brand px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Posting…" : "Post review"}
            </button>
          </div>
        )}

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

            {/* What is going with this report, whether or not the tester did
                anything to arrange it. Stated plainly rather than silently
                attached: someone filing a report is entitled to know what is
                being sent on their behalf. */}
            <div className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
              <p className="text-[11px] font-black uppercase tracking-wide text-muted">
                Attached automatically
              </p>
              <ul className="mt-1.5 space-y-1 text-xs font-semibold text-zinc-700">
                <li>
                  {clipState === "flushing"
                    ? "📹 Saving the last few seconds…"
                    : pendingClip
                      ? `📹 Replay — last ${Math.round(pendingClip.durationMs / 1000)}s`
                      : capturing
                        ? "📹 Replay will be attached when you report"
                        : "📹 No replay — start auto-screenshot to enable it"}
                </li>
                <li>
                  {pendingErrors.length > 0
                    ? `⚠️ ${pendingErrors.length} error${pendingErrors.length === 1 ? "" : "s"} from the game`
                    : errorWatch === "cross-origin"
                      ? "⚠️ This game runs on another site — its errors can't be read"
                      : "⚠️ No errors so far"}
                </li>
              </ul>
            </div>

            {/* Pin one of the automatic grabs to the report. A bug reading
                "the score resets when you pause" is a claim; the same bug with
                the moment on screen is evidence — and the tester already has
                one to hand, so this costs them a click rather than a workflow. */}
            {shots.length > 0 && (
              <div className="mt-4">
                <p className="text-[11px] font-black uppercase tracking-wide text-muted">
                  Attach a screenshot
                </p>
                <ul className="mt-1.5 flex gap-1.5 overflow-x-auto pb-1">
                  {shots.map((shot) => {
                    const picked = attachedId === shot.id;
                    return (
                      <li key={shot.id} className="shrink-0">
                        <button
                          type="button"
                          // Clicking the picked one clears it, so an attachment
                          // can be undone without closing the composer.
                          onClick={() =>
                            setAttachedId(picked ? null : shot.id)
                          }
                          aria-pressed={picked}
                          className={`block overflow-hidden rounded-lg border-2 transition ${
                            picked
                              ? "border-brand ring-2 ring-brand/30"
                              : "border-border hover:border-brand/50"
                          }`}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={shot.previewUrl}
                            alt=""
                            className="h-14 w-auto"
                          />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

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

      <SessionTutorial
        playerId={playerId}
        open={tutorialOpen}
        onClose={() => setTutorialOpen(false)}
      />

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
