"use client";

/**
 * Opening a pack: inspect → tear → emerge → reveal → summary.
 *
 * THE RESULT COMES FIRST. The server opens the pack (atomically, once) the moment
 * the tear commits, and the cards emerge only after its answer is in hand. So:
 *   - every rarity cue on screen is the true one (a card's back glows in its
 *     real rarity before it is flipped);
 *   - leaving half-way loses nothing: the cards are already in the binder, and
 *     coming back to this page shows them (the open call is idempotent);
 *   - a failed call leaves the pack sealed on screen and says so; trying again
 *     is safe, and returns the same cards if the first call did land.
 *
 * Everything has a non-drag path: the Tear button (or Enter/Space on the pack),
 * Enter/Space or a click per card, Reveal all, and Skip (Esc). Each reveal is
 * read out ("Card 2 of 3: Rare, The Caretaker, new"). Sound is off by default.
 * Reduced motion swaps movement for short fades and keeps every rarity cue.
 */

import "../collectibles.css";
import "./opening.css";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { startSignIn } from "@/app/lib/auth-actions";
import { getCollectible, getCollection, getPack, packVersion } from "@/app/lib/collectibles/catalogue";
import { EMERGE, FLIP_MS, HOLD_MS, TEAR, revealLine, slotLines, tearCommits, tearProgress, type TearSample } from "@/app/lib/collectibles/opening";
import { FlipCard } from "../Card";
import { PackArt } from "../Pack";
import { playChime, playFlip, playTear, readSoundPref, writeSoundPref } from "./sound";

type Pull = { slot: number; collectibleId: string; wasNew: boolean };
type Stage = "loading" | "signed-out" | "missing" | "revoked" | "error" | "inspect" | "opening" | "emerge" | "reveal";
type SealedPack = { publicId: string; packId: string; packVersion: number };
type Progress = { collection: string; owned: number; total: number; percent: number };

const reduced = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function openOnServer(id: string): Promise<{ ok: true; alreadyOpened: boolean; packId: string; packVersion: number; pulls: Pull[] } | { ok: false; status: number }> {
  try {
    const res = await fetch(`/api/v1/collection/packs/${encodeURIComponent(id)}/open`, { method: "POST", credentials: "include", cache: "no-store" });
    if (!res.ok) return { ok: false, status: res.status };
    const body = (await res.json()) as { alreadyOpened: boolean; pack: { packId: string; packVersion: number }; pulls: Pull[] };
    return { ok: true, alreadyOpened: body.alreadyOpened, packId: body.pack.packId, packVersion: body.pack.packVersion, pulls: [...body.pulls].sort((a, b) => a.slot - b.slot) };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** The jagged edge that follows the tear: teeth along the seal's bottom up to `p`, from the side the drag began. */
function sealClip(p: number, fromRight: boolean): string | undefined {
  if (p <= 0) return undefined;
  const teeth = Math.max(2, Math.round(p * 24));
  const pts: string[] = [];
  for (let i = 0; i <= teeth; i++) {
    const x = (i / teeth) * p * 100;
    const y = i % 2 ? 72 : 100;
    pts.push(`${(fromRight ? 100 - x : x).toFixed(2)}% ${y}%`);
  }
  return fromRight
    ? `polygon(0 0, 100% 0, ${pts.join(", ")}, 0 100%)`
    : `polygon(0 0, 100% 0, 100% 100%, ${pts.reverse().join(", ")})`;
}

export function OpeningFlow({ id }: { id: string }) {
  const [stage, setStage] = useState<Stage>("loading");
  const [pack, setPack] = useState<SealedPack | null>(null);
  const [pulls, setPulls] = useState<Pull[]>([]);
  const [openedBefore, setOpenedBefore] = useState(false);
  const [flipped, setFlipped] = useState<boolean[]>([]);
  // A card is "settled" once its flip has finished. The summary and the New /
  // Duplicate tags wait for every card to settle, so they never give away a
  // card that is still turning over.
  const [settled, setSettled] = useState<boolean[]>([]);
  const [charging, setCharging] = useState<number | null>(null);
  const [line, setLine] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [turned, setTurned] = useState(false);
  const [sound, setSound] = useState(false);
  const [tear, setTear] = useState({ p: 0, fromRight: false, dragging: false, torn: false });
  const [progress, setProgress] = useState<Progress | null>(null);
  const [narrow, setNarrow] = useState(false);
  const [attempt, setAttempt] = useState(0);

  const drag = useRef<{ start: TearSample; prev: TearSample | null; last: TearSample | null; width: number; frame: number } | null>(null);
  const cardRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const summaryRef = useRef<HTMLHeadingElement>(null);
  const busy = useRef(false);
  const alive = useRef(true);
  // The flips as they really are right now (state lags a render behind), and
  // the cards mid-hold, so a double click or Reveal all never turns one twice.
  const turnedOver = useRef<boolean[]>([]);
  const holding = useRef(new Set<number>());
  const revealingAll = useRef(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Sound preference and the narrow layout, read once on the client.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 680px)");
    const sync = () => setNarrow(mq.matches);
    const t = setTimeout(() => {
      setSound(readSoundPref());
      sync();
    }, 0);
    mq.addEventListener("change", sync);
    return () => {
      clearTimeout(t);
      mq.removeEventListener("change", sync);
    };
  }, []);

  const showOpened = useCallback((packId: string, version: number, got: Pull[], before: boolean) => {
    setPack({ publicId: id, packId, packVersion: version });
    setPulls(got);
    setOpenedBefore(before);
    turnedOver.current = got.map(() => before);
    setFlipped(turnedOver.current);
    setSettled(got.map(() => before));
  }, [id]);

  const loadProgress = useCallback(async (collection: string) => {
    try {
      const res = await fetch("/api/v1/collection", { credentials: "include", cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { progress?: Progress[] };
      const mine = body.progress?.find((p) => p.collection === collection);
      if (mine && alive.current) setProgress(mine);
    } catch {
      // Progress is a nicety; the cards are what matter.
    }
  }, []);

  // Find the pack. Sealed → inspect. Otherwise ask the (idempotent) open call,
  // which answers with the stored cards if it was opened before.
  useEffect(() => {
    let live = true;
    (async () => {
      let res: Response | null = null;
      try {
        res = await fetch("/api/v1/collection", { credentials: "include", cache: "no-store" });
      } catch {
        res = null;
      }
      if (!live) return;
      if (res?.status === 401) return setStage("signed-out");
      if (!res?.ok) return setStage("error");
      const body = (await res.json()) as { available?: boolean; sealed?: SealedPack[] };
      if (!live) return;
      if (body.available === false) return setStage("error");
      const sealed = body.sealed?.find((p) => p.publicId === id);
      if (sealed && getPack(sealed.packId)) {
        setPack(sealed);
        setStage("inspect");
        return;
      }
      const opened = await openOnServer(id);
      if (!live) return;
      if (!opened.ok) return setStage(opened.status === 401 ? "signed-out" : opened.status === 404 ? "missing" : opened.status === 410 ? "revoked" : "error");
      showOpened(opened.packId, opened.packVersion, opened.pulls, true);
      setStage("reveal");
      const col = getPack(opened.packId)?.collection;
      if (col) void loadProgress(col);
    })();
    return () => {
      live = false;
    };
  }, [id, attempt, showOpened, loadProgress]);

  const allFlipped = flipped.length > 0 && flipped.every(Boolean);
  const allSettled = settled.length > 0 && settled.every(Boolean);
  useEffect(() => {
    if (stage === "reveal" && allSettled && !openedBefore) summaryRef.current?.focus();
  }, [stage, allSettled, openedBefore]);

  /** Tear committed: open on the server while the strip falls away, then let the cards out. */
  const commitTear = useCallback(async () => {
    if (busy.current || !pack) return;
    busy.current = true;
    setNotice(null);
    setTear((t) => ({ ...t, p: 1, dragging: false, torn: true }));
    setStage("opening");
    if (sound) playTear();
    const [opened] = await Promise.all([openOnServer(pack.publicId), wait(reduced() ? 150 : TEAR.completeMs + 380)]);
    busy.current = false;
    if (!alive.current) return;
    if (!opened.ok) {
      if (opened.status === 401) return setStage("signed-out");
      if (opened.status === 404) return setStage("missing");
      if (opened.status === 410) return setStage("revoked");
      setTear({ p: 0, fromRight: false, dragging: false, torn: false });
      setNotice("That didn't go through. Your pack is safe; try again.");
      setStage("inspect");
      return;
    }
    showOpened(opened.packId, opened.packVersion, opened.pulls, false);
    setStage("emerge");
    const emergeMs = reduced() ? 150 : EMERGE.staggerMs * (opened.pulls.length - 1) + EMERGE.eachMs + 60;
    await wait(emergeMs);
    if (!alive.current) return;
    setStage("reveal");
    setLine(`${opened.pulls.length} cards. Choose one to turn it over, or reveal all.`);
    requestAnimationFrame(() => cardRefs.current[0]?.focus());
    const col = getPack(opened.packId)?.collection;
    if (col) void loadProgress(col);
  }, [pack, sound, showOpened, loadProgress]);

  const flip = useCallback(
    async (i: number) => {
      const pull = pulls[i];
      const card = pull && getCollectible(pull.collectibleId);
      if (!card || turnedOver.current[i] || holding.current.has(i)) return;
      const hadFocus = typeof document !== "undefined" && document.activeElement === cardRefs.current[i];
      if (HOLD_MS[card.rarity] > 0) {
        holding.current.add(i);
        setCharging(i);
        await wait(HOLD_MS[card.rarity]);
        holding.current.delete(i);
        if (!alive.current || turnedOver.current[i]) return;
      }
      setCharging((c) => (c === i ? null : c));
      turnedOver.current = turnedOver.current.map((v, j) => (j === i ? true : v));
      setFlipped(turnedOver.current);
      setTimeout(() => {
        if (alive.current) setSettled((s) => s.map((v, j) => (j === i ? true : v)));
      }, reduced() ? 200 : FLIP_MS[card.rarity]);
      if (sound) {
        playFlip();
        setTimeout(() => playChime(card.rarity), FLIP_MS[card.rarity] * 0.6);
      }
      setLine(revealLine(i + 1, pulls.length, pull.collectibleId, pull.wasNew));
      // The button just turned over is gone; keep the keyboard on the next card.
      if (hadFocus) {
        requestAnimationFrame(() => {
          const order = [...cardRefs.current.keys()].sort((a, b) => (a > i ? a : a + 100) - (b > i ? b : b + 100));
          for (const j of order) {
            const el = cardRefs.current[j];
            if (el && !turnedOver.current[j]) return el.focus();
          }
        });
      }
    },
    [pulls, sound],
  );

  const revealAll = useCallback(async () => {
    if (revealingAll.current) return;
    revealingAll.current = true;
    for (let i = 0; i < pulls.length; i++) {
      if (turnedOver.current[i]) continue;
      await flip(i);
      if (!alive.current) break;
      await wait(250);
    }
    revealingAll.current = false;
  }, [pulls, flip]);

  const skip = useCallback(() => {
    holding.current.clear();
    setCharging(null);
    turnedOver.current = pulls.map(() => true);
    setFlipped(turnedOver.current);
    setSettled(pulls.map(() => true));
    setLine(pulls.map((p, i) => revealLine(i + 1, pulls.length, p.collectibleId, p.wasNew)).join(" "));
  }, [pulls]);

  // Esc skips to the end once the cards are out.
  useEffect(() => {
    if (stage !== "reveal" && stage !== "emerge") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [stage, skip]);

  // ── The tear gesture ──
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (stage !== "inspect" || turned || e.button !== 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    // Only a drag that starts on the top third (where the seal is) tears.
    if (e.clientY > rect.top + rect.height * 0.33) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    drag.current = { start, prev: null, last: start, width: rect.width, frame: 0 };
    setTear({ p: 0, fromRight: e.clientX > rect.left + rect.width / 2, dragging: true, torn: false });
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    d.prev = d.last;
    d.last = { x: e.clientX, y: e.clientY, t: e.timeStamp };
    if (d.frame) return;
    d.frame = requestAnimationFrame(() => {
      d.frame = 0;
      if (!drag.current || !d.last) return;
      const { progress } = tearProgress(d.start, d.last, d.width);
      setTear((t) => (t.dragging ? { ...t, p: Math.max(t.p, progress) } : t));
    });
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.frame) cancelAnimationFrame(d.frame);
    const { progress } = d.last ? tearProgress(d.start, d.last, d.width) : { progress: 0 };
    if (tearCommits(Math.max(progress, tear.p), d.prev, d.last)) void commitTear();
    else setTear({ p: 0, fromRight: tear.fromRight, dragging: false, torn: false });
  };

  const toggleSound = () => {
    setSound((s) => {
      writeSoundPref(!s);
      return !s;
    });
  };

  const def = pack ? getPack(pack.packId) : undefined;
  const version = pack ? packVersion(pack.packId, pack.packVersion)?.version : undefined;
  const collection = def ? getCollection(def.collection) : undefined;
  const tint = collection?.theme.colours[1] ?? "#ffd84a";
  const cardSize = narrow ? "sm" : "md";

  if (stage === "loading") {
    return <Shell tint={tint} title="Getting your pack…" busy><div className="ho-loading" aria-hidden="true" /></Shell>;
  }
  if (stage === "signed-out") {
    return (
      <Shell tint={tint} title="Sign in to open your packs">
        <p className="ho-copy">Packs belong to your HallPass account, so you need to be signed in to open them.</p>
        <form action={startSignIn}>
          <button type="submit" className="ho-btn ho-btn-primary">Sign in</button>
        </form>
      </Shell>
    );
  }
  if (stage === "missing" || stage === "revoked" || stage === "error") {
    const copy =
      stage === "missing"
        ? "This pack isn't in your account. The link may be wrong, or it belongs to someone else."
        : stage === "revoked"
          ? "HallPass staff withdrew this pack, so it can't be opened."
          : "Your packs couldn't be loaded just now. Nothing is lost.";
    return (
      <Shell tint={tint} title={stage === "error" ? "Something went wrong" : "Can't open this pack"}>
        <p className="ho-copy">{copy}</p>
        <div className="ho-actions">
          {stage === "error" && (
            <button
              type="button"
              className="ho-btn ho-btn-primary"
              onClick={() => {
                setStage("loading");
                setAttempt((a) => a + 1);
              }}
            >
              Try again
            </button>
          )}
          <Link href="/packs" className="ho-btn">Pack Room</Link>
        </div>
      </Shell>
    );
  }

  const cardsOut = stage === "emerge" || stage === "reveal";
  const title = def?.name ?? "Your pack";
  return (
    <Shell tint={tint} title={title}>
      <p className="sr-only" aria-live="polite">{line}</p>

      {!cardsOut && def && (
        <>
          <p className="ho-copy" id="ho-how">
            {stage === "opening" ? "Tearing it open…" : "Drag along the top to tear it open, or press Tear open."}
          </p>
          <div className={`ho-turn${turned ? " is-turned" : ""}`}>
            <div
              className="ho-pack"
              data-torn={tear.torn || undefined}
              data-dragging={tear.dragging || undefined}
              tabIndex={stage === "inspect" && !turned ? 0 : -1}
              role="button"
              aria-describedby="ho-how"
              aria-label={`${def.name}. Tear it open.`}
              aria-hidden={turned || undefined}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  void commitTear();
                }
              }}
            >
              <PackArt
                packId={def.id}
                tilt={stage === "inspect" && !tear.dragging ? 12 : 0}
                decorative
                sealStyle={
                  {
                    clipPath: tear.torn ? undefined : sealClip(tear.p, tear.fromRight),
                    transformOrigin: tear.fromRight ? "0% 100%" : "100% 100%",
                    transform: tear.torn
                      ? `translate(${tear.fromRight ? -140 : 140}px, -90px) rotate(${tear.fromRight ? -38 : 38}deg)`
                      : tear.p > 0
                        ? `translateY(${(-tear.p * 10).toFixed(1)}px) rotate(${((tear.fromRight ? -1 : 1) * tear.p * 9).toFixed(1)}deg)`
                        : undefined,
                    opacity: tear.torn ? 0 : 1,
                    transition: tear.dragging ? "none" : "transform 380ms cubic-bezier(.3,.7,.3,1), opacity 380ms ease",
                  } as CSSProperties
                }
              />
            </div>
            <div className="ho-pack-back" aria-hidden={!turned || undefined}>
              <h2>What&apos;s inside</h2>
              <p>{version?.size ?? 3} cards, decided when you open it:</p>
              <ul>{version && slotLines(version).map((l) => <li key={l}>{l}</li>)}</ul>
              <p className="ho-fine">Every card of a rarity is equally likely. The odds are the same for everyone.</p>
            </div>
          </div>
          {notice && <p className="ho-notice" role="alert">{notice}</p>}
          <div className="ho-actions">
            <button type="button" className="ho-btn ho-btn-primary" onClick={() => void commitTear()} disabled={stage !== "inspect"}>
              Tear open
            </button>
            <button type="button" className="ho-btn" onClick={() => setTurned((t) => !t)} aria-pressed={turned} disabled={stage !== "inspect"}>
              {turned ? "Turn to the front" : "Turn over"}
            </button>
          </div>
        </>
      )}

      {cardsOut && (
        <>
          {openedBefore && <p className="ho-copy">You opened this pack before. Here&apos;s what was inside.</p>}
          <ul className="ho-row" aria-label="Cards in this pack">
            {pulls.map((p, i) => {
              const card = getCollectible(p.collectibleId);
              if (!card) return null;
              const shown = flipped[i];
              return (
                <li key={p.slot} className="ho-slot" style={{ "--i": i } as CSSProperties}>
                  {/* The card stays mounted from face down to face up, so the flip animates; the button sits over it until then. */}
                  <div className="ho-card" data-charging={charging === i || undefined}>
                    <FlipCard card={card} flipped={shown} size={cardSize} ms={FLIP_MS[card.rarity]} isNew={p.wasNew} />
                    {!shown && (
                      <button
                        type="button"
                        ref={(el) => {
                          cardRefs.current[i] = el;
                        }}
                        className="ho-hit"
                        onClick={() => void flip(i)}
                        disabled={stage !== "reveal"}
                        aria-label={`Turn over card ${i + 1} of ${pulls.length}`}
                      />
                    )}
                  </div>
                  {allSettled && <span className={`ho-tag${p.wasNew ? " is-new" : ""}`}>{p.wasNew ? "New" : "Duplicate"}</span>}
                </li>
              );
            })}
          </ul>

          {!allSettled ? (
            <div className="ho-actions">
              <button type="button" className="ho-btn ho-btn-primary" onClick={() => void revealAll()} disabled={stage !== "reveal" || allFlipped}>
                Reveal all
              </button>
              <button type="button" className="ho-btn" onClick={skip} aria-keyshortcuts="Escape">
                Skip
              </button>
            </div>
          ) : (
            <div className="ho-summary">
              <h2 ref={summaryRef} tabIndex={-1}>
                {pulls.filter((p) => p.wasNew).length > 0
                  ? `${pulls.filter((p) => p.wasNew).length} new for your binder`
                  : `All ${pulls.length} were already in your binder`}
              </h2>
              {progress && collection && (
                <p className="ho-copy">
                  {collection.name}: {progress.owned} of {progress.total} collected.
                </p>
              )}
              <div className="ho-actions">
                <Link href="/collection" className="ho-btn ho-btn-primary">See your binder</Link>
                <Link href="/packs" className="ho-btn">Pack Room</Link>
              </div>
            </div>
          )}
        </>
      )}

      <button type="button" className="ho-sound" onClick={toggleSound} aria-pressed={sound}>
        Sound: {sound ? "on" : "off"}
      </button>
    </Shell>
  );
}

function Shell({ tint, title, busy = false, children }: { tint: string; title: string; busy?: boolean; children: React.ReactNode }) {
  return (
    <section className="hc-root ho-stage" style={{ "--ho-tint": tint } as CSSProperties} aria-busy={busy || undefined} aria-labelledby="ho-title">
      <h1 id="ho-title" className="ho-title">{title}</h1>
      {children}
    </section>
  );
}
