"use client";

/**
 * Opening a pack, as one continuous physical sequence
 * (docs/collectibles-opening.md):
 *
 *   sealed      turn the pack in the light, press it, drag along the top
 *   tearing     the foil splits along the finger; let go early and it settles
 *   committing  the tear is done: the server opens the pack (ONCE), the strip
 *               flies off and the mouth eases open while we wait
 *   opened      the face-down stack rises in the mouth
 *   extracting  the stack is drawn out; the empty wrapper drops away
 *   revealing   the cards are dealt and turned over one at a time, rarest
 *               last; rare and up get their plate and their light
 *   summary     what you got, what is new, how the collection stands
 *
 * THE RESULT COMES FROM THE SERVER, NEVER FROM THE ANIMATION. The open call is
 * made from the commit handler only, guarded by an in-flight ref and the state
 * machine; it is idempotent server-side, so a refresh at any point shows the
 * same cards (resumed where this device left off, `resume.ts`). If it fails the
 * pack is shown whole again and nothing is lost. Animation callbacks only ever
 * dispatch events, and the reducer ignores any that arrive in the wrong stage.
 *
 * Everything has a non-drag path (Open it, Enter/Space on the pack, a button
 * per card, Reveal all, Skip or Esc), every reveal is announced, and reduced
 * motion swaps movement for short fades without hiding anything.
 */

import "../collectibles.css";
import "./opening.css";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { startSignIn } from "@/app/lib/auth-actions";
import { getCollectible, getCollection, getPack, packVersion } from "@/app/lib/collectibles/catalogue";
import type { Collectible } from "@/app/lib/collectibles/catalogue/types";
import { revealLine, slotLines } from "@/app/lib/collectibles/opening";
import { RARITY_LABEL, RARITY_RANK } from "@/app/lib/collectibles/present";
import { CardBack, type CardSize } from "../Card";
import { haptics } from "./haptics";
import { bestPull, CARD_PX, chooseFit, frontPlace, placeCards, summaryHeight, type Place } from "./placement";
import { canCommit, canSkip, initialOpening, openFailure, openingReducer, type Pull, type SealedPack } from "./machine";
import { EASE, isAborted, play, sleep } from "./motion";
import { seedOf } from "./noise";
import { PackStage, type PackStageHandle } from "./pack/PackStage";
import { readResume, resumeFor, writeResume } from "./resume";
import { RevealCard, type CardAction } from "./RevealCard";
import { packSounds, readSoundPref, setSoundEnabled, unlockSound, writeSoundPref } from "./sound";

type Progress = { collection: string; owned: number; total: number; percent: number };
type Opened = { ok: true; packId: string; packVersion: number; openedAt: string | null; pulls: Pull[] } | { ok: false; status: number };

export interface OpeningLinks {
  open(publicId: string): string;
  room: string;
}
const DEFAULT_LINKS: OpeningLinks = { open: (p) => `/packs?pack=${p}`, room: "/packs" };

/** The opening playing over the Pack Room (room/OpeningLayer) rather than on a page of its own. */
export interface InRoom {
  /** Back to the counter. */
  close(): void;
  /** Open another sealed pack, in the same place. */
  next(publicId: string): void;
  /** The sealed packs as the room last saw them: one of these starts sealed at once, with no round trip first. */
  sealed: SealedPack[];
  /** The pack has drawn its first frame (WebGL or the fallback), so the room's stand-in can go. */
  onPackReady?(): void;
}

/** The deck inside the pouch: its top edge (share of the pack's height) and each card's offset in the stack. */
const DECK_TOP = 0.17;
const DECK_JIT = [
  { x: 0, y: 0, r: 0 },
  { x: 3, y: 4, r: -1.4 },
  { x: -3, y: 7, r: 1.6 },
];
const MOUTH = 0.118;
const DEAL_STAGGER = 120;
const DEAL_MS = 620;

async function openOnServer(id: string): Promise<Opened> {
  try {
    const res = await fetch(`/api/v1/collection/packs/${encodeURIComponent(id)}/open`, { method: "POST", credentials: "include", cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json()) as { pack: { packId: string; packVersion: number; openedAt?: string | null }; pulls: Pull[] };
    return { ok: true, packId: body.pack.packId, packVersion: body.pack.packVersion, openedAt: body.pack.openedAt ?? null, pulls: [...body.pulls].sort((a, b) => a.slot - b.slot) };
  } catch {
    return { ok: false, status: 0 };
  }
}

type CollectionBody = { available?: boolean; sealed?: SealedPack[]; progress?: Progress[] };
async function loadCollection(): Promise<{ status: number; body: CollectionBody | null }> {
  try {
    const res = await fetch("/api/v1/collection", { credentials: "include", cache: "no-store" });
    return { status: res.status, body: res.ok ? ((await res.json()) as CollectionBody) : null };
  } catch {
    return { status: 0, body: null };
  }
}

/** Fetch the card art before it is needed, so a face never turns up blank. */
function preload(pulls: Pull[]) {
  for (const p of pulls) {
    const src = getCollectible(p.collectibleId)?.art.src;
    if (!src) continue;
    const img = new Image();
    img.decoding = "async";
    img.src = src;
  }
}

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", notify);
      return () => m.removeEventListener("change", notify);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function OpeningFlow({ id, links = DEFAULT_LINKS, room }: { id: string; links?: OpeningLinks; room?: InRoom }) {
  // In the room the pack is already known to be sealed; the server still decides everything when it is opened.
  const [state, dispatch] = useReducer(openingReducer, room?.sealed.find((p) => p.publicId === id), (known) =>
    known && getPack(known.packId) ? openingReducer(initialOpening(), { type: "loaded-sealed", pack: known }) : initialOpening(),
  );
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const reduced = useMedia("(prefers-reduced-motion: reduce)");
  const sounds = useMemo(() => packSounds(), []);

  const [loadKey, setLoadKey] = useState(0);
  const [others, setOthers] = useState<SealedPack[]>(() => (room?.sealed ?? []).filter((p) => p.publicId !== id && getPack(p.packId)));
  const [progress, setProgress] = useState<Progress[]>([]);
  const [line, setLine] = useState("");
  const [sound, setSound] = useState(false);
  const [table, setTable] = useState({ w: 0, h: 0 });
  const [openH, setOpenH] = useState(0);
  const [packGone, setPackGone] = useState(false);
  const [dealt, setDealt] = useState(false);
  const [deckFrom, setDeckFrom] = useState<Place[] | null>(null);
  const [revealAll, setRevealAll] = useState(false);
  /** Which cards have shown their face (the plate and the tag wait for it). */
  const [faces, setFaces] = useState<boolean[]>([]);

  const alive = useRef(true);
  const inFlight = useRef(false);
  const commitAt = useRef(0);
  const stage = useRef<HTMLElement | null>(null);
  const tableEl = useRef<HTMLDivElement | null>(null);
  const pack = useRef<PackStageHandle>(null);
  const packWrap = useRef<HTMLDivElement>(null);
  const deckMove = useRef<HTMLDivElement>(null);
  const deckCards = useRef<(HTMLDivElement | null)[]>([]);
  const buttons = useRef<(HTMLElement | null)[]>([]);
  const summaryHead = useRef<HTMLHeadingElement>(null);
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      sounds.stopAll();
    };
  }, [sounds]);

  // Sound: off unless this device turned it on.
  useEffect(() => {
    const t = window.setTimeout(() => setSound(readSoundPref()), 0);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => setSoundEnabled(sound), [sound]);

  // ── Measuring: the stage fills the screen below the site header (and above a phone's tab bar). ──
  const ro = useRef<ResizeObserver | null>(null);
  const fitStage = useCallback(() => {
    const el = stage.current;
    if (el) el.style.setProperty("--ho-top", `${Math.max(0, Math.round(el.getBoundingClientRect().top + window.scrollY))}px`);
  }, []);
  const stageRef = useCallback(
    (el: HTMLElement | null) => {
      stage.current = el;
      fitStage();
    },
    [fitStage],
  );
  useEffect(() => {
    window.addEventListener("resize", fitStage);
    return () => window.removeEventListener("resize", fitStage);
  }, [fitStage]);
  const tableRef = useCallback((el: HTMLDivElement | null) => {
    ro.current?.disconnect();
    tableEl.current = el;
    if (!el) return;
    ro.current = new ResizeObserver(([entry]) => {
      const size = { w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) };
      setTable(size);
      if (stateRef.current.stage !== "summary") setOpenH(size.h);
    });
    ro.current.observe(el);
  }, []);
  useEffect(() => () => ro.current?.disconnect(), []);

  const announce = useCallback((text: string) => setLine(text), []);

  // ── Load: is the pack sealed, or already open (a refresh, another device)? ──
  useEffect(() => {
    if (state.stage !== "loading") return;
    let live = true;
    (async () => {
      const col = await loadCollection();
      if (!live) return;
      if (col.status === 401) return dispatch({ type: "load-failed", failure: "signed-out" });
      if (!col.body || col.body.available === false) return dispatch({ type: "load-failed", failure: "error" });
      setOthers((col.body.sealed ?? []).filter((p) => p.publicId !== id && getPack(p.packId)));
      setProgress(col.body.progress ?? []);
      const sealed = col.body.sealed?.find((p) => p.publicId === id);
      if (sealed && getPack(sealed.packId)) return dispatch({ type: "loaded-sealed", pack: sealed });
      // Not sealed: the open call is idempotent and answers with the stored cards.
      const opened = await openOnServer(id);
      if (!live) return;
      if (!opened.ok) {
        const f = openFailure(opened.status);
        return dispatch({ type: "load-failed", failure: f === "retryable" ? "error" : f });
      }
      preload(opened.pulls);
      const r = resumeFor(readResume(id), opened.openedAt, opened.pulls.length);
      dispatch({ type: "loaded-opened", pack: { publicId: id, packId: opened.packId, packVersion: opened.packVersion }, pulls: opened.pulls, flipped: r.flipped, done: r.done });
    })();
    return () => {
      live = false;
    };
  }, [state.stage, id, loadKey]);

  const refreshProgress = useCallback(async () => {
    const col = await loadCollection();
    if (alive.current && col.body?.progress) setProgress(col.body.progress);
  }, []);

  // Started sealed from the room's list: the collection's progress still comes from the server.
  const startedSealed = useRef(state.stage === "sealed");
  useEffect(() => {
    if (startedSealed.current) void refreshProgress();
  }, [refreshProgress]);

  // ── The one server call: when the tear completes (or Open it / Enter finishes it). ──
  const commit = useCallback(async () => {
    const s = stateRef.current;
    if (inFlight.current || !canCommit(s) || !s.pack) return;
    inFlight.current = true;
    commitAt.current = performance.now();
    dispatch({ type: "commit" });
    sounds.tearEnd(true);
    haptics.snap();
    announce("Opening your pack…");
    const res = await openOnServer(s.pack.publicId);
    inFlight.current = false;
    if (!alive.current) return;
    if (res.ok) {
      preload(res.pulls);
      dispatch({ type: "open-ok", pulls: res.pulls });
      announce(`Your pack is open: ${res.pulls.length} cards.`);
      void refreshProgress();
    } else {
      const f = openFailure(res.status);
      dispatch({ type: "open-failed", failure: f });
      if (f === "retryable") {
        pack.current?.reset();
        announce("That didn't go through. Your pack is safe and still sealed.");
      }
    }
  }, [announce, refreshProgress, sounds]);

  // ── Layout ──
  const summary = state.stage === "summary";
  // Decided on the table as it is during the opening (the summary shrinks it).
  const fit = chooseFit({ w: table.w, h: openH || table.h });
  const tray = fit.tray;
  const revealSize: CardSize = fit.size;
  const revealSizeRef = useRef(revealSize);
  useEffect(() => {
    if (!summary) revealSizeRef.current = revealSize;
  });
  const cardPx = CARD_PX[revealSize];
  /** The card in front (the machine's name for it is `current`). */
  const front = state.current;
  const cards = state.pulls.map((p) => getCollectible(p.collectibleId)).filter((c): c is Collectible => !!c);
  const ranks = cards.map((c) => RARITY_RANK[c.rarity]).join();
  const best = useMemo(() => bestPull(ranks ? ranks.split(",").map(Number) : []), [ranks]);
  // The results lay the cards out in the table as it is then (a column of its own on laptops).
  const places = useMemo(
    () => placeCards({ tray, table: { w: table.w, h: summary ? table.h : openH || table.h }, card: cardPx, count: cards.length, flipped: state.flipped, current: front, summary, best }),
    [tray, table.w, table.h, openH, cardPx, cards.length, state.flipped, front, summary, best],
  );

  // ── Choreography. Each stage's steps stop the moment the stage changes. ──
  const def = state.pack ? getPack(state.pack.packId) : undefined;
  const packW = Math.round(Math.max(140, Math.min(300, table.w * 0.74, ((openH || table.h) - 36) / 1.46)));
  const slotH = packW * 1.46;
  const deckScale = (0.74 * packW) / 300;

  // While the server answers: the strip is off, let the mouth ease open.
  useEffect(() => {
    if (state.stage !== "committing") return;
    const ctl = new AbortController();
    sleep(reduced ? 0 : 520, ctl.signal)
      .then(() => {
        pack.current?.loosen(true);
        sounds.loosen();
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [state.stage, reduced, sounds]);

  // The stack rises into the mouth; the pack is lowered so there is room to draw it out.
  useEffect(() => {
    if (state.stage !== "opened") return;
    const ctl = new AbortController();
    const sig = ctl.signal;
    (async () => {
      if (reduced) return dispatch({ type: "loosened" });
      await sleep(Math.max(0, 640 - (performance.now() - commitAt.current)), sig);
      pack.current?.loosen(true);
      const t = tableEl.current;
      const travel = DECK_TOP * slotH + 280 * deckScale - MOUTH * slotH + 12;
      const restTop = t ? (t.clientHeight - slotH) / 2 : 0;
      const shift = Math.max(0, Math.min((t?.clientHeight ?? 600) * 0.45, 12 + travel - DECK_TOP * slotH - restTop));
      const peek = 0.24 * 280 * deckScale;
      await Promise.all([
        play(packWrap.current, [{ transform: "translateY(0)" }, { transform: `translateY(${shift.toFixed(1)}px)` }], { duration: 560, easing: EASE.inOut, fill: "forwards" }, sig),
        play(deckMove.current, [{ transform: "translateY(0)" }, { transform: `translateY(${-peek.toFixed(1)}px)` }], { duration: 480, delay: 160, easing: EASE.out, fill: "forwards" }, sig),
      ]);
      await sleep(140, sig);
      dispatch({ type: "loosened" });
    })().catch((e) => {
      if (!isAborted(e)) throw e;
    });
    return () => ctl.abort();
  }, [state.stage, reduced, slotH, deckScale]);

  // Draw the stack out, then hand it to the table.
  useEffect(() => {
    if (state.stage !== "extracting") return;
    const ctl = new AbortController();
    const sig = ctl.signal;
    (async () => {
      if (!reduced) {
        sounds.extract();
        pack.current?.tug(1);
        const travel = DECK_TOP * slotH + 280 * deckScale - MOUTH * slotH + 12;
        const peek = 0.24 * 280 * deckScale;
        await play(deckMove.current, [{ transform: `translateY(${-peek.toFixed(1)}px)` }, { transform: `translateY(${-travel.toFixed(1)}px)` }], { duration: 700, easing: EASE.inOut, fill: "forwards" }, sig);
        pack.current?.tug(0);
      }
      // Where each card is now, in table space, so dealing starts exactly there.
      const t = tableEl.current?.getBoundingClientRect();
      const size = CARD_PX[revealSizeRef.current];
      const from = t
        ? deckCards.current.slice(0, stateRef.current.pulls.length).map((el, i) => {
            const r = el?.getBoundingClientRect();
            if (!r) return null;
            return { x: r.left + r.width / 2 - t.left, y: r.top + r.height / 2 - t.top, s: (CARD_PX.md.w * deckScale) / size.w, r: DECK_JIT[i]?.r ?? 0, z: 40 - i };
          })
        : [];
      setDeckFrom(reduced || from.some((p) => !p) ? null : (from as Place[]));
      dispatch({ type: "extracted" });
    })().catch((e) => {
      if (!isAborted(e)) throw e;
    });
    return () => ctl.abort();
  }, [state.stage, reduced, slotH, deckScale, sounds]);

  // Dealt: the empty wrapper drops away while the cards travel to their places.
  const dealing = useRef(false);
  useEffect(() => {
    if (state.stage !== "revealing" || dealing.current) return;
    dealing.current = true;
    const timers: number[] = [];
    if (state.resumed) {
      timers.push(window.setTimeout(() => setDealt(true), 0));
    } else {
      void pack.current?.dropAway().then(() => alive.current && setPackGone(true));
      const n = state.pulls.length;
      for (let i = 0; i < n; i++) {
        timers.push(
          window.setTimeout(() => {
            sounds.deal(i);
            haptics.deal();
          }, reduced ? 0 : i * DEAL_STAGGER + 80),
        );
      }
      timers.push(window.setTimeout(() => setDealt(true), reduced ? 220 : (n - 1) * DEAL_STAGGER + DEAL_MS));
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [state.stage, state.resumed, state.pulls.length, reduced, sounds]);

  // ── Turning cards over ──
  const allFlipped = state.flipped.length > 0 && state.flipped.every(Boolean);
  const midFlip = state.flipped.some((f, i) => f && !state.settled[i]);
  const interactive = state.stage === "revealing" && (dealt || state.resumed);

  const flip = useCallback(
    (i: number) => {
      const s = stateRef.current;
      if (s.stage !== "revealing" || s.flipped[i]) return;
      sounds.flip();
      dispatch({ type: "flip", index: i });
    },
    [sounds],
  );

  /** The one "go on" action: turn over the next card, or move on from the one in front, or finish. */
  const advance = useCallback(() => {
    const s = stateRef.current;
    if (s.stage !== "revealing") return;
    const next = s.flipped.findIndex((f) => !f);
    if (!s.flipped[s.current]) return flip(s.current);
    if (!s.settled[s.current]) return;
    if (next < 0) dispatch({ type: "finish" });
    else dispatch({ type: "next" });
  }, [flip]);

  // Reveal all: keep advancing whenever nothing is mid-turn.
  useEffect(() => {
    if (!revealAll || !interactive || midFlip) return;
    const t = window.setTimeout(advance, 260);
    return () => window.clearTimeout(t);
  }, [revealAll, interactive, midFlip, advance, front, state.flipped]);

  // Keep the keyboard on whatever comes next, unless the player has gone elsewhere
  // on the page. When the focused control goes away (Open it once the tear starts,
  // the last card's button once it is turned) and nothing replaces it yet, focus
  // waits on the stage's title rather than falling to the page.
  useEffect(() => {
    // Not before the opening starts: arriving on the page must not move focus.
    if (summary || state.stage === "loading" || state.stage === "sealed") return;
    const active = document.activeElement;
    const lost = !active || active === document.body;
    if (!lost && !stage.current?.contains(active)) return;
    const target = interactive ? buttons.current[front] : null;
    if (target) target.focus({ preventScroll: true });
    else if (lost) title.current?.focus({ preventScroll: true });
  }, [state.stage, summary, interactive, front, state.settled]);

  // The results: say so, and put the keyboard on them.
  const newCount = state.pulls.filter((p) => p.wasNew).length;
  const summaryTitle = newCount > 0 ? `${newCount} new for your binder` : "Nothing new this time";
  useEffect(() => {
    if (!summary) return;
    sounds.complete();
    const t = window.setTimeout(() => {
      setLine(`${summaryTitle}. ${state.pulls.map((p, i) => revealLine(i + 1, state.pulls.length, p.collectibleId, p.wasNew)).join(" ")}`);
      const active = document.activeElement;
      if (!active || active === document.body || stage.current?.contains(active)) summaryHead.current?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(t);
    // Once, on arriving at the summary.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [summary]);

  // Remember how far this device got, so a refresh resumes rather than replays.
  useEffect(() => {
    if (!state.pack || (state.stage !== "revealing" && state.stage !== "summary")) return;
    writeResume(state.pack.publicId, { flipped: state.flipped, done: state.stage === "summary" });
  }, [state.pack, state.stage, state.flipped]);

  // ── Skip: the same cards, face up, now. ──
  const skip = useCallback(() => {
    if (!canSkip(stateRef.current)) return;
    sounds.stopAll();
    dispatch({ type: "skip" });
  }, [sounds]);
  const skippable = canSkip(state);
  useEffect(() => {
    if (!skippable) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [skippable, skip]);

  // In the room, Escape puts the pack back (or leaves the results) when nothing is under way.
  const closable = !!room && ["sealed", "summary", "signed-out", "missing", "revoked", "error"].includes(state.stage);
  useEffect(() => {
    if (!closable || !room) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) room.close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [closable, room]);

  const toggleSound = () => {
    const on = !sound;
    setSound(on);
    writeSoundPref(on);
    setSoundEnabled(on);
    if (on) unlockSound();
  };

  // ── Render ──
  const collection = def ? getCollection(def.collection) : undefined;
  const tint = collection?.theme.colours[1] ?? "#ffd84a";
  const version = state.pack ? packVersion(state.pack.packId, state.pack.packVersion)?.version : undefined;

  if (state.stage === "loading") {
    return (
      <Shell tint={tint} inRoom={!!room} title="Getting your pack…" busy>
        <div className="ho-loading" aria-hidden="true" />
      </Shell>
    );
  }
  if (state.stage === "signed-out") {
    return (
      <Shell tint={tint} inRoom={!!room} title="Sign in to open your packs">
        <p className="ho-copy">Packs belong to your HallPass account, so you need to be signed in to open them.</p>
        <div className="ho-actions">
          <form action={startSignIn}>
            <button type="submit" className="ho-btn ho-btn-primary">
              Sign in
            </button>
          </form>
          {room && (
            <button type="button" className="ho-btn" onClick={room.close}>
              Back to the Pack Room
            </button>
          )}
        </div>
      </Shell>
    );
  }
  if (state.stage === "missing" || state.stage === "revoked" || state.stage === "error") {
    const copy =
      state.stage === "missing"
        ? "This pack isn't in your account. The link may be wrong, or it belongs to someone else."
        : state.stage === "revoked"
          ? "HallPass staff withdrew this pack, so it can't be opened."
          : "Your packs couldn't be loaded just now. Nothing is lost.";
    return (
      <Shell tint={tint} inRoom={!!room} title={state.stage === "error" ? "Something went wrong" : "Can't open this pack"}>
        <p className="ho-copy">{copy}</p>
        <div className="ho-actions">
          {state.stage === "error" && (
            <button
              type="button"
              className="ho-btn ho-btn-primary"
              onClick={() => {
                dispatch({ type: "retry" });
                setLoadKey((k) => k + 1);
              }}
            >
              Try again
            </button>
          )}
          {room ? (
            <button type="button" className="ho-btn" onClick={room.close}>
              Back to the Pack Room
            </button>
          ) : (
            <Link href={links.room} className="ho-btn">
              Pack Room
            </Link>
          )}
        </div>
      </Shell>
    );
  }

  const sealedish = state.stage === "sealed" || state.stage === "tearing";
  const showPack = !!def && (["sealed", "tearing", "committing", "opened", "extracting"].includes(state.stage) || (state.stage === "revealing" && !packGone && !state.resumed));
  const showDeck = state.stage === "opened" || state.stage === "extracting";
  const showCards = (state.stage === "revealing" || summary) && table.w > 0 && cards.length === state.pulls.length;
  const prog = progress.find((p) => p.collection === def?.collection);
  /** Cards from this pack that were new to the set the progress box is about. */
  const freshInSet = state.pulls.filter((p) => p.wasNew && getCollectible(p.collectibleId)?.collection === def?.collection).length;
  const n = cards.length;

  const actionFor = (i: number): CardAction | null => {
    if (!interactive || i !== state.current) return null;
    if (!state.flipped[i]) return { label: `Turn over card ${i + 1} of ${n}`, run: () => flip(i) };
    if (!state.settled[i]) return null;
    return { label: allFlipped ? `See all ${n} cards` : "Next card", run: advance, swipe: true };
  };
  /** The one button under the card: what tapping the card does too. */
  const goLabel = !state.flipped[front] ? "Turn it over" : allFlipped ? `See all ${n === 3 ? "three" : n}` : "Next card";
  const goReady = interactive && !midFlip && !revealAll;
  // The card in front, once its face is up: its plate (rare and up), its light, its tag.
  const faceUp = (i: number) => !!(faces[i] || state.settled[i]);
  const frontCard = cards[front];
  const frontPull = state.pulls[front];
  const frontAt = frontPlace({ w: table.w, h: openH || table.h }, cardPx);
  const rank = frontCard ? RARITY_RANK[frontCard.rarity] : 0;
  const showMoment = state.stage === "revealing" && !!frontCard && faceUp(front);

  return (
    <section
      ref={stageRef}
      className="hc-root ho-stage"
      data-stage={state.stage}
      data-tray={tray}
      data-room={room ? "" : undefined}
      // Until the table has been measured the pack is drawn at its smallest; the room's flight waits for this.
      data-measured={table.w > 0 ? "" : undefined}
      style={{ "--ho-tint": tint, "--ho-pack-w": `${packW}px` } as CSSProperties}
      aria-labelledby="ho-title"
      onPointerDownCapture={() => unlockSound()}
    >
      <header className="ho-bar">
        <div className="ho-heading">
          <h1 id="ho-title" ref={title} tabIndex={-1} className="ho-title">
            {def?.name ?? "Your pack"}
          </h1>
          {collection && <p className="ho-sub">{collection.name}</p>}
        </div>
        <div className="ho-tools">
          {room && closable && (
            <button type="button" className="ho-chip" onClick={room.close} aria-keyshortcuts="Escape">
              {summary ? "Close" : "Put it back"}
            </button>
          )}
          {skippable && (
            <button type="button" className="ho-chip" onClick={skip} aria-keyshortcuts="Escape">
              Skip
            </button>
          )}
          <button type="button" className="ho-chip" onClick={toggleSound} aria-pressed={sound}>
            <SpeakerIcon on={sound} /> Sound {sound ? "on" : "off"}
          </button>
        </div>
      </header>

      {summary && (
        <div className="ho-sum-head">
          <p className="ho-kicker">{state.resumed ? "Opened before" : "Pack opened"}</p>
          <h2 ref={summaryHead} tabIndex={-1}>
            {summaryTitle}
          </h2>
          <p className="ho-copy">{state.resumed ? "You opened this pack before. Here's what was inside." : `${def?.name ?? "Your pack"}. The cards are in your binder now.`}</p>
        </div>
      )}

      <div ref={tableRef} className="ho-table" style={summary && tray === "dots" ? { height: summaryHeight(cardPx) } : undefined}>
        {showPack && def && state.pack && (
          <div ref={packWrap} className="ho-pack-wrap">
            <PackStage
              ref={pack}
              packId={def.id}
              seed={seedOf(state.pack.publicId)}
              interactive={sealedish}
              reducedMotion={reduced}
              label={`${def.name}. Tear it open.`}
              describedBy="ho-how"
              onTearStart={() => {
                dispatch({ type: "tear-start" });
                sounds.tearStart();
                haptics.grab();
              }}
              onTearAdvance={(advance, speed) => {
                sounds.tear(advance, speed);
                haptics.tearTick();
              }}
              onTearSettle={() => {
                dispatch({ type: "tear-cancel" });
                sounds.tearEnd(false);
              }}
              onCommit={() => void commit()}
              onHandle={(k) => sounds.crinkle(k)}
              onRenderer={() => room?.onPackReady?.()}
            >
              {showDeck && (
                <div ref={deckMove} className="ho-deck-move" style={{ top: `${DECK_TOP * 100}%` }}>
                  <div className="ho-deck" style={{ transform: `translateX(-50%) scale(${deckScale.toFixed(4)})` }}>
                    {state.pulls.map((p, i) => (
                      <div
                        key={p.slot}
                        ref={(el) => {
                          deckCards.current[i] = el;
                        }}
                        className="ho-deck-card"
                        style={{ zIndex: 10 - i, transform: `translate(${DECK_JIT[i]?.x ?? 0}px, ${DECK_JIT[i]?.y ?? 0}px) rotate(${DECK_JIT[i]?.r ?? 0}deg)` }}
                      >
                        <CardBack size="md" />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </PackStage>
          </div>
        )}

        {showCards && (
          <div className="ho-cards" role="group" aria-label="Your cards">
            {showMoment && rank >= 3 && (
              <div
                key={`glow-${front}`}
                className="ho-glow"
                data-rarity={frontCard.rarity}
                style={{ transform: `translate(${frontAt.x}px, ${frontAt.y}px) translate(-50%, -50%)` }}
                aria-hidden="true"
              />
            )}
            {showMoment && rank >= 3 && (
              <p
                key={`plate-${front}`}
                className="ho-plate"
                data-rarity={frontCard.rarity}
                style={{ left: frontAt.x, top: frontAt.y - (cardPx.h * frontAt.s) / 2 - 14 }}
                aria-hidden="true"
              >
                {RARITY_LABEL[frontCard.rarity]}
              </p>
            )}
            {summary && cards[best] && RARITY_RANK[cards[best].rarity] >= 3 && places[best] && (
              <p className="ho-best" style={{ left: places[best].x, top: places[best].y - (cardPx.h * places[best].s) / 2 - 10 }} aria-hidden="true">
                Best pull
              </p>
            )}
            {summary &&
              tray === "side" &&
              places.map((p, i) =>
                state.pulls[i] ? (
                  <p key={`cap-${state.pulls[i].slot}`} className="ho-cap-under" style={{ left: p.x, top: p.y + (cardPx.h * p.s) / 2 + 10 }} aria-hidden="true">
                    {state.pulls[i].wasNew ? <Tag isNew /> : "Already in your binder"}
                  </p>
                ) : null,
              )}
            {showMoment && (
              <p key={`tag-${front}`} className="ho-under" style={{ left: frontAt.x, top: frontAt.y + (cardPx.h * frontAt.s) / 2 + 14 }} aria-hidden="true">
                <Tag isNew={frontPull.wasNew} long />
              </p>
            )}
            {cards.map((card, i) => {
              const pull = state.pulls[i];
              const place = places[i];
              return (
                <RevealCard
                  key={pull.slot}
                  card={card}
                  isNew={pull.wasNew}
                  size={revealSize}
                  place={place}
                  flipped={state.flipped[i]}
                  settled={state.settled[i]}
                  reduced={reduced}
                  from={deckFrom && !state.resumed ? { place: deckFrom[i], delay: i * DEAL_STAGGER } : null}
                  action={actionFor(i)}
                  href={summary ? `/collectibles/${card.id}` : undefined}
                  hrefLabel={`${card.name}: ${RARITY_LABEL[card.rarity]}, ${pull.wasNew ? "new" : "duplicate"}. View card`}
                  hrefHidden={tray === "dots"}
                  buttonRef={(el) => {
                    buttons.current[i] = el;
                  }}
                  onFaceShown={() => {
                    setFaces((f) => {
                      const next = [...f];
                      next[i] = true;
                      return next;
                    });
                    // A turn still finishing after Skip must not talk over the summary.
                    if (stateRef.current.stage !== "revealing") return;
                    sounds.reveal(card.rarity);
                    haptics.reveal(card.rarity);
                    announce(revealLine(i + 1, n, pull.collectibleId, pull.wasNew));
                  }}
                  onSettled={() => dispatch({ type: "flip-done", index: i })}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="ho-foot">
        {sealedish && def && (
          <>
            <p className="ho-copy" id="ho-how">
              Drag across the top of the pack to tear it open.
            </p>
            {state.notice && (
              <p className="ho-notice" role="alert">
                {state.notice}
              </p>
            )}
            <div className="ho-actions">
              <button type="button" className="ho-btn ho-btn-primary" onClick={() => pack.current?.autoTear()}>
                Open it
              </button>
              {version && (
                <details className="ho-odds">
                  <summary className="ho-btn">What&apos;s inside?</summary>
                  <div className="ho-odds-panel">
                    <p>{version.size} cards, decided by the server when you open it:</p>
                    <ul>
                      {slotLines(version).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                    <p className="ho-fine">Every card of a rarity is equally likely. The odds are the same for everyone.</p>
                  </div>
                </details>
              )}
            </div>
          </>
        )}
        {state.stage === "committing" && (
          <p className="ho-copy" aria-hidden="true">
            Opening…
          </p>
        )}
        {state.stage === "revealing" && (
          <>
            {state.resumed && <p className="ho-copy">You opened this pack before. Here&apos;s where you left off.</p>}
            {tray === "dots" && n > 1 && (
              <p className="ho-dots" aria-hidden="true">
                {state.pulls.map((p, i) => (
                  <span key={p.slot} data-on={i === front || state.flipped[i] || undefined} data-here={i === front || undefined} />
                ))}
              </p>
            )}
            <div className="ho-actions">
              <button type="button" className="ho-btn ho-btn-primary ho-go" onClick={() => goReady && advance()} aria-disabled={!goReady || undefined}>
                {goLabel}
              </button>
              {!allFlipped && (
                <button type="button" className="ho-link" onClick={() => interactive && setRevealAll(true)} aria-disabled={!interactive || revealAll || undefined}>
                  Reveal all
                </button>
              )}
            </div>
          </>
        )}
        {summary && (
          <div className="ho-summary">
            <ul className="ho-results">
              {state.pulls.map((p) => {
                const c = getCollectible(p.collectibleId);
                if (!c) return null;
                return (
                  <li key={p.slot} data-rarity={c.rarity}>
                    <Link href={`/collectibles/${c.id}`}>{c.name}</Link>
                    <span className="ho-rarity">{RARITY_LABEL[c.rarity]}</span>
                    <Tag isNew={p.wasNew} />
                  </li>
                );
              })}
            </ul>
            {prog && collection && <Progress name={collection.name} owned={prog.owned} total={prog.total} fresh={freshInSet} />}
            <div className="ho-sum-actions">
              <Link href="/collection" className="ho-btn ho-btn-primary">
                See them in your binder
              </Link>
              <div className="ho-sum-row">
                {room ? (
                  <button type="button" className="ho-btn" onClick={room.close}>
                    Back to the Pack Room
                  </button>
                ) : (
                  <Link href={links.room} className="ho-btn">
                    Back to the Pack Room
                  </Link>
                )}
                {others[0] &&
                  (room ? (
                    <button type="button" className="ho-btn" onClick={() => room.next(others[0].publicId)}>
                      Next pack ({others.length} left)
                    </button>
                  ) : (
                    <Link href={links.open(others[0].publicId)} className="ho-btn">
                      Next pack ({others.length} left)
                    </Link>
                  ))}
              </div>
              <Link href="/packs#pack-odds" className="ho-link">
                How rare is this? See the odds
              </Link>
            </div>
          </div>
        )}
      </div>

      <p className="sr-only" role="status" aria-live="polite">
        {line}
      </p>
    </section>
  );
}

/** How the set stands after this pack: a segment per card, the ones this pack added lit up in turn. */
function Progress({ name, owned, total, fresh }: { name: string; owned: number; total: number; fresh: number }) {
  const before = owned - fresh;
  return (
    <div className="ho-prog">
      <p className="ho-prog-head">
        <span className="ho-prog-name">{name}</span>
        <span className="ho-prog-ct">
          <b>{owned}</b> of {total}
        </span>
        {fresh > 0 && <span className="ho-prog-new">+{fresh} new</span>}
      </p>
      {total <= 40 ? (
        <span className="ho-segs" aria-hidden="true">
          {Array.from({ length: total }, (_, i) => (
            <i key={i} data-on={i < owned || undefined} data-new={(i >= before && i < owned) || undefined} style={{ "--k": i - before } as CSSProperties} />
          ))}
        </span>
      ) : (
        <span className="ho-bar-track" aria-hidden="true">
          <span style={{ width: `${Math.min(100, Math.max(2, (owned / Math.max(1, total)) * 100))}%` }} />
        </span>
      )}
      <p className="ho-prog-goal">{owned >= total ? "Set complete!" : `${total - owned} still to find. Every pack is free, and the odds are the same for everyone.`}</p>
    </div>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 6v4h2.5l3.5 3V3L5 6z" fill="currentColor" stroke="none" />
      {on ? <path d="M10.5 5.5a3.5 3.5 0 0 1 0 5M12.3 3.8a6 6 0 0 1 0 8.4" /> : <path d="M10.5 6l4 4M14.5 6l-4 4" />}
    </svg>
  );
}

function Tag({ isNew, long = false }: { isNew: boolean; long?: boolean }) {
  const text = long ? (isNew ? "New for your binder" : "Already in your binder") : isNew ? "New" : "Had it";
  return <span className={`ho-tag${isNew ? " is-new" : ""}${long ? " is-long" : ""}`}>{text}</span>;
}

function Shell({ tint, title, busy = false, inRoom, children }: { tint: string; title: string; busy?: boolean; inRoom: boolean; children: React.ReactNode }) {
  return (
    <section
      className="hc-root ho-stage ho-shell"
      data-room={inRoom ? "" : undefined}
      style={{ "--ho-tint": tint } as CSSProperties}
      aria-busy={busy || undefined}
      aria-labelledby="ho-title"
    >
      <h1 id="ho-title" className="ho-title" tabIndex={-1}>
        {title}
      </h1>
      {children}
    </section>
  );
}
