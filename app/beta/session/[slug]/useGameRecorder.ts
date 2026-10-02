"use client";

/**
 * The recorder's state machine and its React wiring.
 *
 * Kept out of `TestSessionClient.tsx` (already ~1200 lines) and written as a
 * reducer so every transition is testable without a browser. A discriminated
 * union rather than a handful of booleans: "recording but also stopping" and
 * "ready with no take" are states the UI would otherwise have to rule out by
 * hand.
 *
 * The capability probe uses `useSyncExternalStore` with a `() => null` server
 * snapshot for the reason documented at `canRecord` in the session client: reading
 * `MediaRecorder` during render makes the control absent from the SSR HTML and
 * present on hydration, and React recovers from that mismatch by REMOUNTING THE
 * GAME IFRAME.
 */

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useSyncExternalStore,
  type RefObject,
} from "react";
import {
  browserSupportFailure,
  GameRecorder,
  probeRecordable,
  type RecordedTake,
} from "@/app/lib/capture/game-recorder";
import type {
  EventSource,
  RecordingEventType,
} from "@/app/lib/capture/record-events";
import { limitsFor, type RecordFailure } from "@/app/lib/capture/record-policy";
import { saveBlob, sidecarBlob } from "@/app/lib/capture/save-take";

export type RecState =
  | { phase: "idle" }
  | { phase: "starting" }
  | { phase: "recording"; elapsedMs: number; bytes: number; layered: boolean; silent: boolean }
  | { phase: "stopping" }
  | { phase: "ready"; take: RecordedTake }
  | { phase: "refused"; reason: RecordFailure };

export type RecAction =
  | { type: "start" }
  | { type: "started"; layered: boolean; silent: boolean }
  | { type: "refused"; reason: RecordFailure }
  | { type: "tick"; elapsedMs: number; bytes: number }
  | { type: "stopping" }
  | { type: "finished"; take: RecordedTake }
  | { type: "aborted" }
  | { type: "discard" };

export function recReducer(state: RecState, action: RecAction): RecState {
  switch (action.type) {
    case "start":
      // Starting from "ready" is a re-record: the previous take is dropped.
      return state.phase === "idle" || state.phase === "ready" || state.phase === "refused"
        ? { phase: "starting" }
        : state;
    case "started":
      return state.phase === "starting"
        ? {
            phase: "recording",
            elapsedMs: 0,
            bytes: 0,
            layered: action.layered,
            silent: action.silent,
          }
        : state;
    case "refused":
      return state.phase === "starting" ? { phase: "refused", reason: action.reason } : state;
    case "tick":
      return state.phase === "recording"
        ? { ...state, elapsedMs: action.elapsedMs, bytes: action.bytes }
        : state;
    case "stopping":
      return state.phase === "recording" ? { phase: "stopping" } : state;
    case "finished":
      // Also accepted while "recording": a cap or an error ends the take without
      // the tester pressing anything.
      return state.phase === "recording" || state.phase === "stopping"
        ? { phase: "ready", take: action.take }
        : state;
    case "aborted":
      // A take that was in progress could not be produced (the recorder threw while
      // finishing). Without this the UI sat on "Saving…" forever.
      return state.phase === "recording" || state.phase === "stopping"
        ? { phase: "refused", reason: "failed" }
        : state;
    case "discard":
      return state.phase === "ready" || state.phase === "refused" ? { phase: "idle" } : state;
  }
}

/** `null` when this browser can record a canvas, else the reason. */
function useBrowserSupport(): RecordFailure | null {
  return useSyncExternalStore(
    () => () => {},
    () => browserSupportFailure(),
    () => "unsupported" as RecordFailure | null,
  );
}

function isTouch(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export function useGameRecorder({
  iframeRef,
  slug,
  title,
}: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  slug: string;
  title: string;
}) {
  const [state, dispatch] = useReducer(recReducer, { phase: "idle" } as RecState);
  const recorderRef = useRef<GameRecorder | null>(null);
  const unsupported = useBrowserSupport();

  const finishWith = useCallback((take: RecordedTake | null) => {
    recorderRef.current = null;
    dispatch(take ? { type: "finished", take } : { type: "aborted" });
  }, []);
  const abort = useCallback(() => {
    recorderRef.current = null;
    dispatch({ type: "aborted" });
  }, []);

  const start = useCallback(async () => {
    if (recorderRef.current) return;
    dispatch({ type: "start" });
    // Probed NOW, not on load: many games only build their canvas after a start
    // click, and a probe taken earlier would have said "no canvas".
    const probe = probeRecordable(iframeRef.current);
    if (!probe.ok) {
      dispatch({ type: "refused", reason: probe.reason });
      return;
    }
    const recorder = new GameRecorder(probe, {
      slug,
      title,
      limits: limitsFor(isTouch()),
      onTick: (elapsedMs, bytes) => dispatch({ type: "tick", elapsedMs, bytes }),
      onAutoStop: finishWith,
    });
    recorderRef.current = recorder;
    const started = await recorder.start();
    if (!started.ok) {
      recorderRef.current = null;
      dispatch({ type: "refused", reason: started.reason });
      return;
    }
    dispatch({ type: "started", layered: probe.layered, silent: !probe.shimmed });
  }, [iframeRef, slug, title, finishWith]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder) return;
    dispatch({ type: "stopping" });
    try {
      finishWith(await recorder.stop("user"));
    } catch {
      abort();
    }
  }, [finishWith, abort]);

  const addEvent = useCallback(
    (type: RecordingEventType, source: EventSource, data?: Record<string, unknown>) => {
      recorderRef.current?.addEvent(type, source, data);
    },
    [],
  );

  const discard = useCallback(() => dispatch({ type: "discard" }), []);

  const saveVideo = useCallback(() => {
    if (state.phase !== "ready") return;
    saveBlob(state.take.video, state.take.fileNames.video);
  }, [state]);

  const saveEvents = useCallback(() => {
    if (state.phase !== "ready") return;
    saveBlob(sidecarBlob(state.take.sidecar), state.take.fileNames.events);
  }, [state]);

  // The game navigated or reloaded: the canvas being recorded is gone. Keep what
  // exists rather than recording a dead stream.
  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const onLoad = () => {
      const recorder = recorderRef.current;
      if (!recorder?.isRecording) return;
      dispatch({ type: "stopping" });
      void recorder.stop("navigated").then(finishWith, abort);
    };
    frame.addEventListener("load", onLoad);
    return () => frame.removeEventListener("load", onLoad);
  }, [iframeRef, finishWith, abort]);

  // Leaving the page releases every handle. Nothing is downloaded: a take the
  // tester never asked to save is not theirs to find in a downloads folder.
  useEffect(() => {
    return () => {
      // Also covers a take still STARTING: stop() cancels it and releases its
      // handles once the start wait is over.
      void recorderRef.current?.stop("user").catch(() => {});
      recorderRef.current = null;
    };
  }, []);

  return {
    state,
    /** The browser cannot record a canvas at all (null = it can). */
    unsupported,
    start,
    stop,
    addEvent,
    discard,
    saveVideo,
    saveEvents,
  };
}
