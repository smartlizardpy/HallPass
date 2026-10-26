"use client";

/**
 * The collectible itself, and its three other states: locked (not owned yet),
 * face down (before the reveal), and the flip between them.
 *
 * Rarity is drawn as a material (cut, pattern, finish) and also said in words
 * (the pill) and in a pip row, so it reads in greyscale and to a screen reader.
 * Demo art carries a small "demo art" tag until the team's final art lands.
 *
 * Sizes are fixed (`sm` binder grid, `md` reveal, `lg` detail) so the pixel art
 * is always drawn at a whole-number scale: 32 px art at 3×/4×/6×, 48 px at
 * 2×/3×/4×.
 */

import "./collectibles.css";
import { useRef, type CSSProperties } from "react";
import type { Collectible, Rarity } from "@/app/lib/collectibles/catalogue/types";
import { artPixels, cardLabel, cardNumber, collectionColours, RARITY_LABEL, RARITY_RANK } from "@/app/lib/collectibles/present";
import { useHolo, useOnScreenLoop } from "./useHolo";

export type CardSize = "sm" | "md" | "lg";

function Pips({ rarity }: { rarity: Rarity }) {
  const n = RARITY_RANK[rarity];
  return (
    <span className="hc-pips" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((i) => (
        <i key={i} className={i <= n ? "on" : undefined} />
      ))}
    </span>
  );
}

export function CollectibleCard({
  card,
  size = "sm",
  copies,
  isNew = false,
  live = false,
  loop = false,
  decorative = false,
}: {
  card: Collectible;
  size?: CardSize;
  /** Copies owned; a badge shows from 2. */
  copies?: number;
  isNew?: boolean;
  /** Foil follows the pointer (reveal, detail). Grids leave it off. */
  live?: boolean;
  /** The legendary loop, paused off-screen. Only where one card is the focus. */
  loop?: boolean;
  /** Inside a control that already names the card (a link or a button). */
  decorative?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useHolo(ref, { enabled: live && (card.rarity === "epic" || card.rarity === "legendary") });
  useOnScreenLoop(ref, loop && card.rarity === "legendary");
  const { base } = collectionColours(card.collection);
  const px = artPixels(card);
  return (
    <div
      ref={ref}
      className="hc-root hc-card"
      data-rarity={card.rarity}
      data-kind={card.kind}
      data-size={size}
      data-art={px}
      style={{ "--hc-base": base } as CSSProperties}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : cardLabel(card)}
      aria-hidden={decorative || undefined}
    >
      <div className="hc-cut">
        <div className="hc-shape" />
        <div className="hc-face">
          <span className="hc-num">{cardNumber(card)}</span>
          {/* eslint-disable-next-line @next/next/no-img-element -- pixel art at a whole-number scale, no optimiser */}
          <img className="hc-art" src={card.art.src} alt="" width={px} height={px} loading="lazy" decoding="async" draggable={false} />
          <span className="hc-cap">
            <span className="hc-name">{card.name}</span>
            <span className="hc-meta">
              <span className="hc-pill">{RARITY_LABEL[card.rarity]}</span>
              <Pips rarity={card.rarity} />
            </span>
          </span>
          <span className="hc-foil" />
          {card.rarity === "legendary" && (
            <>
              <i className="hc-spark" />
              <i className="hc-spark" />
              <i className="hc-spark" />
            </>
          )}
        </div>
      </div>
      {card.art.status === "demo" && <span className="hc-demo">demo art</span>}
      {isNew && <span className="hc-badge hc-badge-new">NEW</span>}
      {copies !== undefined && copies > 1 && <span className="hc-badge hc-badge-copies">×{copies}</span>}
    </div>
  );
}

/** A card the player does not own yet: its cut, number and rarity, nothing more. */
export function LockedCard({ card, size = "sm" }: { card: Collectible; size?: CardSize }) {
  return (
    <div
      className="hc-root hc-locked"
      data-rarity={card.rarity}
      data-size={size}
      role="img"
      aria-label={`Not collected yet: number ${card.number}, ${RARITY_LABEL[card.rarity]}.`}
    >
      <div className="hc-cut">
        <div className="hc-shape" />
      </div>
      <div className="hc-locked-mark" aria-hidden="true">
        <span className="hc-locked-q">?</span>
        <span className="hc-locked-n">{cardNumber(card)}</span>
        <span className="hc-locked-r">{RARITY_LABEL[card.rarity]}</span>
      </div>
    </div>
  );
}

/** Face down. The glow is the card's TRUE rarity, decided before any animation starts. */
export function CardBack({ rarity, size = "md" }: { rarity: Rarity; size?: CardSize }) {
  return (
    <div className="hc-root hc-back" data-rarity={rarity} data-size={size} aria-hidden="true">
      <div className="hc-cut">
        <div className="hc-shape" />
        <div className="hc-face" />
      </div>
      <div className="hc-back-mark">
        <b>hallpass</b>
      </div>
    </div>
  );
}

/** Back and front in one place; `flipped` turns it over. `ms` sets the flip's length. */
export function FlipCard({
  card,
  flipped,
  size = "md",
  ms = 550,
  isNew,
}: {
  card: Collectible;
  flipped: boolean;
  size?: CardSize;
  ms?: number;
  isNew?: boolean;
}) {
  return (
    <div className="hc-flip" data-flipped={flipped || undefined} style={{ "--flip-ms": `${ms}ms` } as CSSProperties}>
      <div className="hc-flip-inner">
        <CardBack rarity={card.rarity} size={size} />
        <CollectibleCard card={card} size={size} live={flipped} loop={flipped} isNew={flipped && isNew} decorative={!flipped} />
      </div>
    </div>
  );
}
