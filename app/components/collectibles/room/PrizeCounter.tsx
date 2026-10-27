"use client";

/**
 * The Pack Room: an arcade prize counter after school
 * (docs/collectibles-pack-room.md).
 *
 * One painted scene with HTML on top. The newest kind of sealed pack stands on
 * the riser under the lamp, and the others stand along the counter (choosing
 * one brings it forward). An info panel under the pack says what it is, with
 * Open and What's inside?. The left board shows recent pulls; the right board is
 * the collection's progress and the way into the binder.
 *
 * The scene is drawn by the server. Its size, its two compositions (laptop and
 * phone) and its two seasons are CSS (room.css), so nothing shifts when the
 * player's packs arrive from `/api/v1/collection`, and only one season's
 * pictures download. Every position comes from `geometry.ts`, in the art's own
 * pixels, as percentages of the room.
 */

import "../collectibles.css";
import "./room.css";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { MyCollection } from "@/app/lib/collectibles";
import { startSignIn } from "@/app/lib/auth-actions";
import { CATALOGUE, collectionSymbolSrc, getCollectible, getCollection, getPack, packFoilSrc, packPrintSrc, packVersion } from "@/app/lib/collectibles/catalogue";
import type { Rarity } from "@/app/lib/collectibles/catalogue/types";
import { slotLines } from "@/app/lib/collectibles/opening";
import { RARITY_LABEL } from "@/app/lib/collectibles/present";
import type { SealedPack } from "../opening/machine";
import { useMyCollection } from "../useMyCollection";
import { arrange, boxStyle, groupSealed, packBox, pct, SCENES, type Box, type PackGroup } from "./geometry";
import { OpeningLayer, preloadOpening, type Flight } from "./OpeningLayer";

export interface PrizeCounterProps {
  /** The link behind Open, for a new tab or before the page is interactive. A plain click opens the pack here, over the room. */
  openHref?: (publicId: string) => string;
}

const DEFAULT_OPEN = (publicId: string) => `/packs?pack=${publicId}`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A click the page may take over: not a new tab, not a new window. */
const plainClick = (e: React.MouseEvent) => !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/** CSS variables that place an element in each composition (room.css reads `--d*` on laptops, `--p*` on phones). */
function at(desk: Box | null, phone: Box | null): CSSProperties {
  const v: Record<string, string> = {};
  if (desk) {
    const s = boxStyle(desk, SCENES.desk);
    Object.assign(v, { "--dl": s.left, "--dt": s.top, "--dw": s.width, "--dh": s.height });
  }
  if (phone) {
    const s = boxStyle(phone, SCENES.phone);
    Object.assign(v, { "--pl": s.left, "--pt": s.top, "--pw": s.width, "--ph": s.height });
  }
  return v as CSSProperties;
}
const only = (desk: boolean, phone: boolean) => (desk && phone ? undefined : desk ? "desk" : "phone");

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Fright Fest 2026 · earned 28 Oct – 2 Nov · 3 cards · 2 sealed", without repeating what the name says. */
function packLine(group: PackGroup): string {
  const pack = getPack(group.packId);
  const col = pack ? getCollection(pack.collection) : undefined;
  if (!pack || !col) return "";
  const stem = col.name.replace(/\s*\d{4}$/, "");
  const version = packVersion(group.packId, group.items[0].packVersion)?.version;
  return [
    pack.name.startsWith(stem) ? null : col.name,
    col.availableFrom && col.availableUntil ? `earned ${fmtDay(col.availableFrom)} – ${fmtDay(col.availableUntil)}` : null,
    `${version?.size ?? 3} cards`,
    group.items.length > 1 ? `${group.items.length} sealed` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function PrizeCounter({ openHref = DEFAULT_OPEN }: PrizeCounterProps) {
  const [state, , reload] = useMyCollection();
  const data = state.status === "ready" ? state.data : null;
  const [featuredId, setFeaturedId] = useState<string | null>(null);
  const groups = useMemo(() => groupSealed(data?.sealed ?? []), [data]);
  const desk = arrange(groups, featuredId, SCENES.desk.slots.length);
  const featured = desk.featured;
  const sealedCount = data?.sealed.length ?? 0;
  const featuredRef = useRef<HTMLButtonElement | null>(null);
  const focusFeatured = useRef(false);
  const roomRef = useRef<HTMLDivElement>(null);
  /** Where every pack stood just before a swap, so each can glide from there (FLIP). */
  const before = useRef<Map<string, DOMRect> | null>(null);

  useLayoutEffect(() => {
    const from = before.current;
    before.current = null;
    if (!from || !roomRef.current || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const el of roomRef.current.querySelectorAll<HTMLElement>(".pr-pack[data-pack]")) {
      const was = from.get(el.dataset.pack ?? "");
      const now = el.getBoundingClientRect();
      if (!was || !now.width) continue;
      const dx = was.left + was.width / 2 - (now.left + now.width / 2);
      const dy = was.bottom - now.bottom;
      const k = was.width / now.width;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1 && Math.abs(k - 1) < 0.01) continue;
      el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${k})`, transformOrigin: "50% 100%" }, { transform: "none", transformOrigin: "50% 100%" }], {
        duration: 420,
        easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      });
    }
  }, [featuredId]);

  // After bringing a pack forward, the keyboard follows it to the riser.
  useEffect(() => {
    if (!focusFeatured.current) return;
    focusFeatured.current = false;
    featuredRef.current?.focus({ preventScroll: true });
  }, [featuredId]);

  const bringForward = (packId: string) => {
    if (packId === featured?.packId) return;
    const rects = new Map<string, DOMRect>();
    for (const el of roomRef.current?.querySelectorAll<HTMLElement>(".pr-pack[data-pack]") ?? []) rects.set(el.dataset.pack ?? "", el.getBoundingClientRect());
    before.current = rects;
    focusFeatured.current = true;
    setFeaturedId(packId);
  };
  const sheet = useRef<HTMLDialogElement>(null);
  const openSheet = () => sheet.current?.showModal();

  // ── Opening, over the room. The URL says which pack (`?pack=`), so Back closes it and a refresh resumes it. ──
  const [flight, setFlight] = useState<Flight | null>(null);
  /** This page added the history entry, so closing is a step back rather than a replace. */
  const pushed = useRef(false);
  const open = (e: React.MouseEvent, group: PackGroup) => {
    if (!plainClick(e)) return;
    e.preventDefault();
    const publicId = group.items[0].publicId;
    const body = roomRef.current?.querySelector(`.pr-pack[data-role="featured"] .pr-pack-body`);
    const from = body?.getBoundingClientRect();
    setFlight(from && from.width ? { publicId, packId: group.packId, from } : null);
    void preloadOpening();
    const u = new URL(window.location.href);
    u.searchParams.set("pack", publicId);
    window.history.pushState(null, "", `${u.pathname}${u.search}`);
    pushed.current = true;
  };
  const closed = useCallback(() => {
    pushed.current = false;
    setFlight(null);
    void reload();
  }, [reload]);

  // Fetch the opening's code while the player looks around, so Open never waits for it.
  useEffect(() => {
    if (!data?.sealed.length) return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number; cancelIdleCallback?: (h: number) => void };
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(() => void preloadOpening());
      return () => w.cancelIdleCallback?.(h);
    }
    const t = window.setTimeout(() => void preloadOpening(), 1500);
    return () => window.clearTimeout(t);
  }, [data?.sealed.length]);

  return (
    <section className="pr hc-root" aria-labelledby="pr-title" data-status={state.status}>
      <div className="pr-wall" aria-hidden="true" />
      <div className="pr-room" ref={roomRef}>
        <div className="pr-art" aria-hidden="true" />
        {(["desk", "phone"] as const).map((comp) =>
          SCENES[comp].loops.map((l) => (
            <span
              key={`${comp}-${l.file}`}
              className="pr-loop"
              data-in={comp}
              data-season={l.season}
              aria-hidden="true"
              style={
                {
                  ...at(comp === "desk" ? l : null, comp === "phone" ? l : null),
                  "--frames": l.frames,
                  "--dur": `${(l.frames / l.fps).toFixed(3)}s`,
                  backgroundImage: `url(/collectibles/room/a/${l.file})`,
                } as CSSProperties
              }
            />
          )),
        )}

        <h1 id="pr-title" className="sr-only">
          Pack Room
        </h1>
        <p className="sr-only">Packs are free. You earn them by playing, and you never have to buy anything.</p>

        {featured && (
          <Pack
            key={`f-${featured.packId}`}
            group={featured}
            featured
            style={at(packBox(SCENES.desk.featured), packBox(SCENES.phone.featured))}
            buttonRef={featuredRef}
            href={openHref(featured.items[0].publicId)}
            onOpen={(e) => open(e, featured)}
            away={flight?.packId === featured.packId}
          />
        )}
        {desk.counter.map((g, i) => (
          <Pack
            key={`s-${g.packId}`}
            group={g}
            data-in={only(i < SCENES.desk.slots.length, i < SCENES.phone.slots.length)}
            style={at(SCENES.desk.slots[i] ? packBox(SCENES.desk.slots[i]) : null, SCENES.phone.slots[i] ? packBox(SCENES.phone.slots[i]) : null)}
            onChoose={() => bringForward(g.packId)}
          />
        ))}

        <Panel state={state.status} featured={featured} openHref={openHref} onOpen={open} sealedCount={sealedCount} onAll={openSheet} />
        {featured && (
          <button type="button" className="pr-chip" data-in="desk" onClick={openSheet} aria-haspopup="dialog">
            <b>{sealedCount}</b> sealed · All packs
          </button>
        )}

        {data && (
          <>
            <RecentBoard data={data} />
            <CollectionBoard data={data} />
          </>
        )}
      </div>
      <AllPacks ref={sheet} groups={groups} featuredId={featured?.packId ?? null} count={sealedCount} onChoose={bringForward} />
      <Suspense fallback={null}>
        <RoomOpening sealed={data?.sealed ?? NONE} flight={flight} pushedRef={pushed} onClosed={closed} />
      </Suspense>
    </section>
  );
}

const NONE: SealedPack[] = [];

/**
 * Reads `?pack=` and plays that pack's opening over the room. On its own, in a
 * Suspense boundary, so reading the query string never stops the server from
 * drawing the room itself.
 */
function RoomOpening({
  sealed,
  flight,
  pushedRef,
  onClosed,
}: {
  sealed: SealedPack[];
  flight: Flight | null;
  pushedRef: React.RefObject<boolean>;
  onClosed(): void;
}) {
  const router = useRouter();
  const raw = useSearchParams().get("pack") ?? "";
  const id = UUID_RE.test(raw) ? raw : null;

  // However it closed (Close, Escape, the browser's Back), the room catches up.
  const was = useRef<string | null>(null);
  useEffect(() => {
    if (was.current && !id) onClosed();
    was.current = id;
  }, [id, onClosed]);

  const close = useCallback(() => {
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    } else if (window.location.pathname === "/packs/open") {
      // Arrived on the old opening link: the room's own address from here on.
      router.replace("/packs", { scroll: false });
    } else {
      const u = new URL(window.location.href);
      u.searchParams.delete("pack");
      window.history.replaceState(null, "", `${u.pathname}${u.search}`);
    }
  }, [pushedRef, router]);

  const next = useCallback((publicId: string) => {
    const u = new URL(window.location.href);
    u.searchParams.set("pack", publicId);
    window.history.replaceState(null, "", `${u.pathname}${u.search}`);
  }, []);

  if (!id) return null;
  return <OpeningLayer id={id} sealed={sealed} flight={flight?.publicId === id ? flight : null} onClose={close} onNext={next} />;
}

// ── All packs: every kind of sealed pack, including the ones that don't fit on the counter ──

function AllPacks({
  ref,
  groups,
  featuredId,
  count,
  onChoose,
}: {
  ref: React.RefObject<HTMLDialogElement | null>;
  groups: PackGroup[];
  featuredId: string | null;
  count: number;
  onChoose(packId: string): void;
}) {
  const close = () => ref.current?.close();
  return (
    // A modal <dialog>: the browser keeps focus inside it, makes the room inert, and closes it on Escape.
    <dialog
      ref={ref}
      className="pr-sheet hc-root"
      aria-labelledby="pr-sheet-title"
      onClick={(e) => {
        // A click on the backdrop (the dialog box itself, outside its content) closes it.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="pr-sheet-in">
        <div className="pr-sheet-head">
          <h2 id="pr-sheet-title">Your sealed packs ({count})</h2>
          <button type="button" className="pr-link" onClick={close}>
            Close
          </button>
        </div>
        <ul>
          {groups.map((g) => {
            const pack = getPack(g.packId);
            const col = pack ? getCollection(pack.collection) : undefined;
            if (!pack) return null;
            const here = g.packId === featuredId;
            return (
              <li key={g.packId}>
                <button
                  type="button"
                  aria-current={here || undefined}
                  onClick={() => {
                    close();
                    onChoose(g.packId);
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at a whole-number scale */}
                  <img src={packPrintSrc(pack.id)} alt="" width={24} height={35} />
                  <span>
                    {pack.name}
                    <small>
                      {col?.name}
                      {g.items.length > 1 ? ` · ×${g.items.length}` : ""}
                    </small>
                  </span>
                  {here && <em>In the light</em>}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </dialog>
  );
}

// ── The packs ──

function Pack({
  group,
  featured = false,
  style,
  href,
  onOpen,
  away = false,
  onChoose,
  buttonRef,
  ...rest
}: {
  group: PackGroup;
  featured?: boolean;
  style: CSSProperties;
  href?: string;
  onOpen?(e: React.MouseEvent): void;
  away?: boolean;
  onChoose?(): void;
  buttonRef?: React.RefObject<HTMLButtonElement | null>;
  "data-in"?: string;
}) {
  const pack = getPack(group.packId);
  const tilt = useTilt(featured);
  if (!pack) return null;
  const n = group.items.length;
  const name = `${pack.name}${n > 1 ? `, ${n} sealed` : ""}`;
  const body = (
    <>
      <span className="pr-pack-body" style={{ "--mask": `url(${packPrintSrc(pack.id)})`, "--foil": `url(${packFoilSrc(pack.id)})` } as CSSProperties}>
        {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at a whole-number scale; next/image would resample it */}
        <img className="pr-pack-print" src={packPrintSrc(pack.id)} alt="" width={96} height={140} draggable={false} decoding="async" />
        <span className="pr-pack-light" />
        <span className="pr-pack-foil" />
        <span className="pr-pack-glare" />
      </span>
      <span className="pr-pack-shadow" aria-hidden="true" />
      {n > 1 && (
        <span className="pr-pack-count" aria-hidden="true">
          ×{n}
        </span>
      )}
    </>
  );
  const common = {
    className: "pr-at pr-pack",
    "data-role": featured ? "featured" : "slot",
    "data-pack": group.packId,
    "data-in": rest["data-in"],
    "data-away": away || undefined,
    style,
    ...tilt,
  };
  return featured && href ? (
    <Link
      {...common}
      ref={buttonRef as unknown as React.Ref<HTMLAnchorElement>}
      href={href}
      aria-label={`Open ${name}`}
      onClick={onOpen}
      onPointerEnter={() => void preloadOpening()}
      onFocus={() => void preloadOpening()}
    >
      {body}
    </Link>
  ) : (
    <button {...common} type="button" onClick={onChoose} aria-label={`${name}. Bring it forward`}>
      {body}
    </button>
  );
}

/** The pack in the light leans toward the pointer and its foil follows (one update per frame). */
function useTilt(on: boolean) {
  const frame = useRef(0);
  if (!on) return {};
  const set = (el: HTMLElement, x: number, y: number) => {
    el.style.setProperty("--px", x.toFixed(3));
    el.style.setProperty("--py", y.toFixed(3));
    el.style.setProperty("--rx", ((x - 0.5) * 14).toFixed(2));
    el.style.setProperty("--ry", ((0.5 - y) * 10).toFixed(2));
  };
  return {
    onPointerMove(e: React.PointerEvent<HTMLElement>) {
      if (e.pointerType !== "mouse") return;
      const el = e.currentTarget;
      const r = el.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        el.dataset.live = "";
        set(el, x, y);
      });
    },
    onPointerLeave(e: React.PointerEvent<HTMLElement>) {
      const el = e.currentTarget;
      cancelAnimationFrame(frame.current);
      delete el.dataset.live;
      set(el, 0.5, 0.3);
    },
  };
}

// ── The info panel: under the pack on laptops, a row of buttons on phones ──

function Panel({
  state,
  featured,
  openHref,
  onOpen,
  sealedCount,
  onAll,
}: {
  state: string;
  featured: PackGroup | null;
  openHref(id: string): string;
  onOpen(e: React.MouseEvent, group: PackGroup): void;
  sealedCount: number;
  onAll(): void;
}) {
  const deskBox = SCENES.desk.featured;
  const phoneBox = SCENES.phone.featured;
  // Centred under the riser; on laptops it tucks up over the riser's lip so Open clears a Chromebook's fold.
  const deskAt = { "--dl": pct(deskBox.x + deskBox.w / 2, SCENES.desk.w), "--dt": pct(deskBox.y + deskBox.h - 20 / 3, SCENES.desk.h) } as CSSProperties;
  const phoneAt = { "--pl": pct(phoneBox.x + phoneBox.w / 2, SCENES.phone.w), "--pt": pct(phoneBox.y + phoneBox.h - 4, SCENES.phone.h) } as CSSProperties;
  // With no pack in the light, the message stands where the pack would.
  const emptyAt = {
    "--dl": pct(deskBox.x + deskBox.w / 2, SCENES.desk.w),
    "--dt": pct(deskBox.y + deskBox.h * 0.35, SCENES.desk.h),
    "--pl": pct(phoneBox.x + phoneBox.w / 2, SCENES.phone.w),
    "--pt": pct(phoneBox.y + phoneBox.h * 0.3, SCENES.phone.h),
  } as CSSProperties;

  if (state === "loading") {
    return (
      <div className="pr-anchor pr-plate pr-note" style={emptyAt} aria-busy="true">
        <p className="pr-note-title">Getting your packs…</p>
      </div>
    );
  }
  if (state === "signedOut") {
    return (
      <div className="pr-anchor pr-plate pr-note" style={emptyAt}>
        <p className="pr-note-title">Sign in to see your packs</p>
        <p className="pr-note-sub">Packs are free and earned by playing. Any you earn wait here.</p>
        <form action={startSignIn}>
          <button type="submit" className="pr-btn pr-primary">
            Sign in
          </button>
        </form>
      </div>
    );
  }
  if (state === "unavailable") {
    return (
      <div className="pr-anchor pr-plate pr-note" style={emptyAt} role="status">
        <p className="pr-note-title">Your packs aren&apos;t available right now</p>
        <p className="pr-note-sub">Nothing is lost. Try again in a little while.</p>
      </div>
    );
  }
  if (!featured) {
    return (
      <div className="pr-anchor pr-plate pr-note" style={emptyAt}>
        <p className="pr-note-title">No sealed packs right now</p>
        <p className="pr-note-sub">Packs are earned by playing, never bought. New ones wait here with no deadline.</p>
        <Link href="/collection" className="pr-btn pr-ghost">
          See your binder
        </Link>
      </div>
    );
  }

  const pack = getPack(featured.packId);
  if (!pack) return null;
  const href = openHref(featured.items[0].publicId);
  const openProps = {
    onClick: (e: React.MouseEvent) => onOpen(e, featured),
    onPointerEnter: () => void preloadOpening(),
    onFocus: () => void preloadOpening(),
  };
  return (
    <>
      <div className="pr-anchor pr-plate pr-info" data-in="desk" style={deskAt}>
        <div className="pr-info-text">
          <h2>{pack.name}</h2>
          <p>{packLine(featured)}</p>
        </div>
        <div className="pr-actions">
          <Link href={href} className="pr-btn pr-primary" aria-label={`Open ${pack.name}`} {...openProps}>
            Open
          </Link>
          <Odds group={featured} label="What's inside?" />
        </div>
      </div>
      <div className="pr-anchor pr-row" data-in="phone" style={phoneAt}>
        <Link href={href} className="pr-btn pr-primary" aria-label={`Open ${pack.name}`} {...openProps}>
          Open
        </Link>
        <Odds group={featured} label="Odds" />
        <button type="button" className="pr-btn pr-ghost" onClick={onAll} aria-haspopup="dialog" aria-label={`All packs: ${sealedCount} sealed`}>
          All {sealedCount}
        </button>
      </div>
    </>
  );
}

/** What's inside: the pack's published odds, slot by slot, in a popover above the button. */
function Odds({ group, label }: { group: PackGroup; label: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const wrap = useRef<HTMLSpanElement>(null);

  // A press anywhere else closes it.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);
  const pack = getPack(group.packId);
  const version = packVersion(group.packId, group.items[0].packVersion)?.version;
  if (!pack || !version) return null;
  return (
    <span className="pr-odds" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="pr-btn pr-ghost"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        {label}
      </button>
      <div
        id={id}
        className="pr-plate pr-odds-pop"
        role="region"
        aria-label={`What's inside ${pack.name}`}
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.stopPropagation();
            setOpen(false);
            button.current?.focus();
          }
        }}
      >
        <b>What&apos;s inside</b>
        <p>{version.size} cards, decided by the server when you open it. The odds are the same for every player, and within a rarity every card is equally likely.</p>
        <table>
          <tbody>
            {slotLines(version).map((line) => {
              const [head, ...tail] = line.split(": ");
              return (
                <tr key={line}>
                  <th scope="row">{head}</th>
                  <td>{tail.join(": ")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </span>
  );
}

// ── The boards ──

const RARITY_VAR: Record<Rarity, string> = {
  common: "var(--hc-r-common)",
  uncommon: "var(--hc-r-uncommon)",
  rare: "var(--hc-r-rare)",
  epic: "var(--hc-r-epic)",
  legendary: "var(--hc-r-legendary)",
};

/** A pulled card as a little sticker: its art on the collection's colour, a rarity bar, a dot when new. */
export function Mini({ collectibleId, isNew }: { collectibleId: string; isNew: boolean }) {
  const card = getCollectible(collectibleId);
  if (!card) return null;
  const col = getCollection(card.collection);
  return (
    <span className="pr-mini" data-new={isNew || undefined} role="img" aria-label={`${card.name}, ${RARITY_LABEL[card.rarity]}${isNew ? ", new" : ""}`}>
      <span style={{ background: col?.theme.colours[0] }}>
        {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at a whole-number scale */}
        <img src={card.art.layout === "full" ? card.art.thumb : card.art.src} alt="" width={32} height={32} loading="lazy" data-full={card.art.layout === "full" || undefined} />
      </span>
      <b style={{ background: RARITY_VAR[card.rarity] }} />
    </span>
  );
}

function RecentBoard({ data }: { data: MyCollection }) {
  const pulls = data.recent.flatMap((o) => [...o.pulls].sort((a, b) => a.slot - b.slot)).slice(0, 12);
  return (
    <div className="pr-at pr-recent" style={at(SCENES.desk.recent, SCENES.phone.recent)}>
      <h2 className="sr-only">Recent pulls</h2>
      {pulls.length === 0 ? (
        <p className="pr-empty">Your first pulls land here</p>
      ) : (
        <div className="pr-minis">
          {pulls.map((p, i) => (
            <Mini key={`${p.collectibleId}-${i}`} collectibleId={p.collectibleId} isNew={p.wasNew} />
          ))}
        </div>
      )}
    </div>
  );
}

function CollectionBoard({ data }: { data: MyCollection }): ReactNode {
  const owned = data.progress.reduce((n, p) => n + p.owned, 0);
  const total = CATALOGUE.collectibles.length;
  const label = `Your binder: ${owned} of ${total} cards. Open your binder`;
  return (
    <>
      <Link href="/collection" className="pr-at pr-coll" data-in="desk" style={at(SCENES.desk.collection, null)} aria-label={label}>
        {data.progress.map((p) => {
          const col = getCollection(p.collection);
          return (
            <span key={p.collection} className="pr-coll-row" title={col?.name}>
              {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at a whole-number scale */}
              <img src={collectionSymbolSrc(p.collection)} alt="" width={16} height={16} />
              <span className="pr-coll-ct">
                {p.owned}/{p.total}
              </span>
              <span className="pr-bar">
                <i style={{ width: `${p.total ? (p.owned / p.total) * 100 : 0}%` }} />
              </span>
            </span>
          );
        })}
      </Link>
      <Link href="/collection" className="pr-at pr-binder" data-in="phone" style={at(null, SCENES.phone.collection)} aria-label={label}>
        <b>
          {owned}/{total}
        </b>
      </Link>
    </>
  );
}
