"use client";

/**
 * One card on the table, from the moment it leaves the pack to the summary.
 *
 * The outer element is placed by the layout (`placement.ts`) and glides between
 * places with a CSS transition; on its first placement it can start from where
 * the card was in the deck (`from`), so being dealt is one continuous move. The
 * inner flipper turns the card over: it lifts toward the player, turns through
 * 180°, and settles. That takes the same time for every card and the face comes
 * into view at the same instant whatever the rarity, so timing never gives a
 * card away. Only once the face is showing does the rarity get its moment.
 *
 * The face is not in the DOM until the flip starts.
 */

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import type { Collectible, Rarity } from "@/app/lib/collectibles/catalogue/types";
import { CardBack, CollectibleCard, type CardSize } from "../Card";
import { placeTransform, type Place } from "./placement";
import { EASE } from "./motion";

/** The turn: lift, rotate, settle. Same for every rarity. */
export const FLIP_MS = 860;
/** When the face comes into view (the flipper passes 90°), as a share of FLIP_MS. */
export const FACE_AT = 0.52;
/** The rarity's one-shot moment after the face is up (matches holo.css). */
export const MOMENT_MS: Record<Rarity, number> = { common: 0, uncommon: 650, rare: 1000, epic: 1200, legendary: 1500 };

export interface CardAction {
  label: string;
  run(): void;
  /** A sideways swipe also runs it (phones: on to the next card). */
  swipe?: boolean;
}

interface Props {
  card: Collectible;
  isNew: boolean;
  size: CardSize;
  place: Place;
  flipped: boolean;
  settled: boolean;
  reduced: boolean;
  /** Where the card starts on its first placement (a place, in the same table space), and after how long it sets off. */
  from?: { place: Place; delay: number } | null;
  action?: CardAction | null;
  href?: string;
  hrefLabel?: string;
  /** The link is a pointer convenience only (the results list carries the accessible one). */
  hrefHidden?: boolean;
  onFaceShown(): void;
  onSettled(): void;
  buttonRef?(el: HTMLElement | null): void;
}

export function RevealCard(props: Props) {
  const { card, size, place, flipped, reduced } = props;
  const root = useRef<HTMLDivElement>(null);
  const flipper = useRef<HTMLDivElement>(null);
  const wasFlipped = useRef(flipped);
  const intro = useRef<Animation | null>(null);
  const cb = useRef(props);
  useEffect(() => {
    cb.current = props;
  });

  // First placement: travel from the deck. Later placements use the CSS transition.
  useLayoutEffect(() => {
    const el = root.current;
    const from = cb.current.from;
    if (!el || !from) return;
    const to = placeTransform(cb.current.place);
    intro.current = el.animate(
      reduced ? [{ opacity: 0 }, { opacity: 1 }] : [{ transform: placeTransform(from.place) }, { transform: to }],
      { duration: reduced ? 200 : 620, delay: reduced ? 0 : from.delay, easing: EASE.out, fill: "backwards" },
    );
    return () => intro.current?.cancel();
    // Only on mount: `from` describes where this element was born.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new place while the deal is still running: let the transition take over from here.
  useLayoutEffect(() => {
    const a = intro.current;
    if (a && a.playState === "running" && !reduced) {
      a.cancel();
      intro.current = null;
    }
  }, [place.x, place.y, place.s, place.r, reduced]);

  // Turn over, once, when `flipped` becomes true.
  useEffect(() => {
    if (!flipped || wasFlipped.current) return;
    wasFlipped.current = true;
    const el = flipper.current;
    const front = el?.querySelector<HTMLElement>(".ho-side-front");
    const timers: number[] = [];
    let anim: Animation | null = null;
    const moment = () => {
      const cardEl = front?.querySelector<HTMLElement>(".hc-card");
      const ms = reduced ? 0 : MOMENT_MS[card.rarity];
      if (cardEl && ms > 0) cardEl.setAttribute("data-moment", "");
      timers.push(
        window.setTimeout(() => {
          cardEl?.removeAttribute("data-moment");
          cb.current.onSettled();
        }, ms),
      );
    };
    if (reduced || !el) {
      anim = front?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" }) ?? null;
      cb.current.onFaceShown();
      timers.push(window.setTimeout(moment, 180));
    } else {
      anim = el.animate(
        [
          { transform: "translateY(0) rotateY(0deg) scale(1)", offset: 0, easing: EASE.lift },
          { transform: "translateY(-5%) rotateY(0deg) scale(1.07)", offset: 0.26, easing: "cubic-bezier(0.45, 0, 0.55, 1)" },
          { transform: "translateY(-5%) rotateY(180deg) scale(1.09)", offset: 0.78, easing: EASE.settle },
          { transform: "translateY(0) rotateY(180deg) scale(1)", offset: 1 },
        ],
        { duration: FLIP_MS },
      );
      timers.push(window.setTimeout(() => cb.current.onFaceShown(), FLIP_MS * FACE_AT));
      anim.finished.then(moment).catch(() => {});
    }
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      anim?.cancel();
      // Interrupted (Skip, unmount): it still counts as turned over.
      if (wasFlipped.current) cb.current.onSettled();
    };
  }, [flipped, reduced, card.rarity]);

  // Swipe: a sideways drag of more than 40 px on the card runs its action (and
  // swallows the click that follows it).
  const press = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const action = props.action;

  return (
    <div
      ref={root}
      className="ho-rcard"
      data-size={size}
      data-face={flipped || undefined}
      style={{ transform: placeTransform(place), zIndex: place.z } as CSSProperties}
    >
      <div ref={flipper} className="ho-flipper" data-face={flipped || undefined}>
        <div className="ho-side ho-side-back">
          <CardBack size={size} />
        </div>
        {flipped && (
          <div className="ho-side ho-side-front">
            <CollectibleCard card={card} size={size} holo="live" loop={size !== "sm"} decorative={!!props.href} tiltFrom={root} />
          </div>
        )}
      </div>
      {props.href ? (
        <Link
          ref={props.buttonRef}
          className="ho-hit"
          href={props.href}
          aria-label={props.hrefHidden ? undefined : props.hrefLabel}
          aria-hidden={props.hrefHidden || undefined}
          tabIndex={props.hrefHidden ? -1 : undefined}
        />
      ) : (
        action && (
          <button
            ref={props.buttonRef}
            type="button"
            className="ho-hit"
            aria-label={action.label}
            onClick={() => {
              if (swiped.current) swiped.current = false;
              else action.run();
            }}
            onPointerDown={(e) => {
              press.current = { x: e.clientX, y: e.clientY };
              swiped.current = false;
            }}
            onPointerUp={(e) => {
              const p = press.current;
              press.current = null;
              if (!p || !action.swipe) return;
              const dx = e.clientX - p.x;
              if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(e.clientY - p.y) * 1.5) {
                swiped.current = true;
                action.run();
              }
            }}
          />
        )
      )}
    </div>
  );
}
