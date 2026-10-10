"use client";

/**
 * The beta session's side of `HallPass.moment()`.
 *
 * A game marks a moment; the injected shim (`record-shim.ts`) hands the call to
 * `__hpRec.onMoment` at the end of the frame the game drew in; this hook admits
 * it (`moments.ts`), takes the picture, and puts it in the tester's filmstrip.
 *
 * ── WHERE THE PICTURE COMES FROM ────────────────────────────────────────────
 * With screen share running, the shared tab, cropped to the game: it shows the
 * HTML a game draws over its canvas, always comes out 16:9 (so any moment can be
 * offered to the gallery), and works for games with no canvas. Without it, or
 * when it yields nothing, the game's own canvas is read. While a bug report's
 * freeze-frame is up it covers the game inside the shared area, so the shared tab
 * is skipped and the canvas is read instead.
 *
 * The shared tab runs a little behind the game, so its picture can be a frame or
 * so late. The canvas read happens in the SAME task as the game's call, which is
 * what lets it work on WebGL; the fall-back from a failed shared-tab grab happens
 * after an await and may read a cleared buffer, in which case there is no picture
 * and the moment says so rather than showing a blank one.
 *
 * ── WHAT STAYS WHERE ────────────────────────────────────────────────────────
 * The pictures live in the session's `shots` filmstrip (`pushShot`), so pinning
 * one to a report and sending one to the gallery are the paths that already exist.
 * This hook only remembers which shot was which moment, so a report can carry the
 * moment's name and data. Nothing is uploaded here.
 *
 * Moments made before the iframe's `load` event are lost - the page cannot listen
 * until then. A game that marks a moment during its own start-up should not.
 */

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { grabGameFrame } from "@/app/lib/capture/dom-capture";
import { MomentLog, type RawMoment } from "@/app/lib/capture/moments";
import type { RecordingEventType, EventSource } from "@/app/lib/capture/record-events";
import type { FrameGrabber, Shot } from "@/app/lib/capture/tab-capture";

/** Moments remembered by shot id. Older ones fall out with their filmstrip place. */
const REMEMBERED_SHOTS = 60;

type ShimHandle = { onMoment: ((moment: RawMoment) => void) | null };

export type MomentRef = { name: string; data: Record<string, unknown> | null };

export function useGameMoments(options: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  /** The running screen-share grabber, if any. */
  grabberRef: RefObject<FrameGrabber | null>;
  /** True while the report freeze-frame covers the game. */
  freezeActive: boolean;
  pushShot: (shot: Shot) => void;
  addEvent: (
    type: RecordingEventType,
    source: EventSource,
    data?: Record<string, unknown>,
    atEpochMs?: number,
  ) => void;
}) {
  const { iframeRef, grabberRef, pushShot, addEvent } = options;
  const logRef = useRef<MomentLog | null>(null);
  const byShotRef = useRef(new Map<string, MomentRef>());
  const freezeRef = useRef(options.freezeActive);
  const [count, setCount] = useState(0);
  const [last, setLast] = useState<{ name: string; shot: boolean } | null>(null);

  useEffect(() => {
    freezeRef.current = options.freezeActive;
  }, [options.freezeActive]);

  const takePicture = useCallback(async (): Promise<Shot | null> => {
    const grabber = grabberRef.current;
    // Started here, in the game's own task: the canvas read below must be too.
    const viaTab = grabber && !freezeRef.current ? grabber.grabNow() : null;
    if (viaTab) {
      try {
        const shot = await viaTab;
        if (shot) return shot;
      } catch {
        /* fall through to the canvas */
      }
    }
    const result = await grabGameFrame(iframeRef.current);
    return result.ok ? result.shot : null;
  }, [grabberRef, iframeRef]);

  const onMoment = useCallback(
    (raw: RawMoment) => {
      const log = (logRef.current ??= new MomentLog());
      const admission = log.admit(raw, Date.now());
      if (!admission) return;
      setCount((n) => n + 1);

      void (async () => {
        let shot: Shot | null = null;
        if (admission.takePicture) {
          try {
            shot = await takePicture();
          } catch {
            shot = null;
          }
        }
        const { added, evicted } = log.add(admission, shot);
        const remembered = byShotRef.current;
        for (const old of evicted) if (old.shot) remembered.delete(old.shot.id);
        if (shot) {
          remembered.set(shot.id, { name: added.name, data: added.data });
          while (remembered.size > REMEMBERED_SHOTS) {
            const oldest = remembered.keys().next().value;
            if (oldest === undefined) break;
            remembered.delete(oldest);
          }
          pushShot(shot);
        }
        setLast({ name: added.name, shot: Boolean(shot) });
        addEvent(
          "moment",
          "game",
          {
            name: added.name,
            ...(added.data ? { data: added.data } : {}),
            shot: Boolean(shot),
          },
          added.at,
        );
      })();
    },
    [takePicture, pushShot, addEvent],
  );

  // The shim is replaced whenever the game document is, so listen again on every
  // load. A cross-origin game has no shim we can reach; the property read throws
  // and the session simply has no moments.
  const handlerRef = useRef(onMoment);
  useEffect(() => {
    handlerRef.current = onMoment;
  }, [onMoment]);

  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame) return;
    const handle = (raw: RawMoment) => handlerRef.current(raw);
    const hook = (value: typeof handle | null) => {
      try {
        const shim = (frame.contentWindow as unknown as { __hpRec?: ShimHandle } | null)
          ?.__hpRec;
        if (shim) shim.onMoment = value;
      } catch {
        /* cross-origin */
      }
    };
    const attach = () => hook(handle);
    attach();
    frame.addEventListener("load", attach);
    return () => {
      frame.removeEventListener("load", attach);
      hook(null);
    };
  }, [iframeRef]);

  /** Which moment (if any) a filmstrip picture was taken for. */
  const momentFor = useCallback(
    (shotId: string): MomentRef | null => byShotRef.current.get(shotId) ?? null,
    [],
  );

  return { count, last, momentFor };
}
