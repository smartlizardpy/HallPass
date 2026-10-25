"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { CSSProperties } from "react";
import type { Game } from "../../../lib/games";
import { coverImageSrc } from "../../CoverImage";
import { FRIGHT_FEST_THEME } from "../../../lib/events/fright-fest";
import { eventDateLabels } from "../../../lib/events/labels";

const LABELS = eventDateLabels(FRIGHT_FEST_THEME);
import { FRIGHT_FEST_GAMES } from "./registry";

/**
 * The Haunted Arcade hero: a pixel-art night scene, three arcade cabinets, the
 * event title and a torch you move with the pointer.
 *
 * ── RENDERED FOR EVERYONE, SHOWN ONLY UNDER THE SKIN ──────────────────────────
 * The section carries `ha-deco`, which globals.css hides and the skin reveals,
 * and the regular FeaturedBanner is marked `data-ha-regular` so the skin hides
 * THAT instead. Both are in the HTML; CSS decides. The prerendered page is
 * therefore identical for every visitor and never reads the clock.
 *
 * ── NO LAYOUT SHIFT ──────────────────────────────────────────────────────────
 * The hero's box is sized by CSS alone (clamp on svh, fixed on a phone). The
 * canvas is painted after mount INTO that box, so the scene arriving changes
 * pixels, never geometry; until then a flat night colour fills it.
 *
 * ── THE CHAMPIONSHIP IS NOT THIS COMPONENT'S BUSINESS ────────────────────────
 * It only receives `competition` (is the competition live?) from the page and
 * words its copy accordingly. It never imports the championship flag.
 *
 * ── THE TORCH ────────────────────────────────────────────────────────────────
 * Pointer (fine pointers only), touch (tap moves the light), keyboard (focus on
 * a cabinet or the doorway ghost brings the light to it). Pointer tracking is
 * gated on the hero being on screen and is off under reduced motion and still
 * mode, where the light simply stays where it rests (a tap still moves it: a
 * jump, not motion).
 */

// 4x4 ordered dither, regular on purpose so thinning reads as design, not noise.
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];
const SPRITES = "/events/fright-fest/";

function loadImage(name: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = `${SPRITES}${name}.png`;
  });
}

function motionOff(): boolean {
  return (
    window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
    document.documentElement.hasAttribute("data-hp-still")
  );
}

function paintScene(
  hs: HTMLElement,
  school: HTMLImageElement | null,
  trees: HTMLImageElement | null,
  phone: boolean,
): [number, number] {
  const u = parseInt(getComputedStyle(hs).getPropertyValue("--u"), 10) || 4;
  const W = hs.clientWidth;
  const H = hs.clientHeight;
  const w = Math.ceil(W / u);
  const h = Math.ceil(H / u);
  const cv = hs.querySelector<HTMLCanvasElement>(".ha-bg")!;
  cv.width = w;
  cv.height = h;
  cv.style.width = `${w * u}px`;
  cv.style.height = `${h * u}px`;
  const x = cv.getContext("2d")!;
  x.imageSmoothingEnabled = false;
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sr = hs.getBoundingClientRect();
  const rel = (el: Element) => {
    const r = el.getBoundingClientRect();
    return { l: (r.left - sr.left) / u, r: (r.right - sr.left) / u, t: (r.top - sr.top) / u, b: (r.bottom - sr.top) / u };
  };
  const floorH = phone ? 16 : 9;
  const gy = h - floorH;

  // Sky: four flat bands, darkest at the top, each joined by one dithered row.
  const SKY = ["#0f0a1a", "#160d27", "#1f1335", "#2b1a47"];
  const bh = gy / SKY.length;
  SKY.forEach((col, i) => {
    x.fillStyle = col;
    x.fillRect(0, Math.round(i * bh), w, Math.ceil(bh) + 1);
  });
  for (let i = 1; i < SKY.length; i++) {
    const yy = Math.round(i * bh) - 1;
    x.fillStyle = SKY[i];
    for (let xx = yy & 1; xx < w; xx += 2) x.fillRect(xx, yy, 1, 1);
  }
  // Stars, kept off the copy so the text never sits on a speck.
  const cp = rel(hs.querySelector(".ha-copy")!);
  for (let s = 0; s < w * 0.16; s++) {
    const sx = Math.floor(rnd() * w);
    const sy = Math.floor(rnd() * gy * 0.6);
    const bright = rnd() > 0.72;
    if (sx > cp.l - 3 && sx < cp.r + 3 && sy > cp.t - 3 && sy < cp.b + 3) continue;
    x.fillStyle = bright ? "#d8cbe6" : "#4d3a6b";
    x.fillRect(sx, sy, 1, 1);
  }
  // Far hills, one shade off the horizon, for depth.
  x.fillStyle = "#1c112d";
  for (let xx = 0; xx < w; xx++) {
    const hy = Math.round(gy - 11 - 3 * Math.sin(xx / 19) - 2 * Math.sin(xx / 7 + 1));
    x.fillRect(xx, hy, 1, gy - hy);
  }
  if (trees) for (let tx = 0; tx < w; tx += 96) x.drawImage(trees, tx, gy - 28);
  // The school sits between the copy and the cabinets, sign and tower in view.
  const cabs = [...hs.querySelectorAll(".ha-cab")].map((el) => ({
    ...rel(el),
    acc: getComputedStyle(el).getPropertyValue("--acc").trim(),
  }));
  const cabsL = Math.min(...cabs.map((cb) => cb.l));
  const sx = phone ? Math.round(cabsL - 84) : Math.round(Math.min(cabsL - 86, cp.r + 2));
  const sy = gy - 56;
  if (school) x.drawImage(school, sx, sy);
  // Hallway floor: 2-unit checker tiles.
  for (let yy = gy; yy < h; yy++)
    for (let xx = 0; xx < w; xx++) {
      x.fillStyle = ((xx >> 1) + (yy >> 1)) & 1 ? "#170e24" : "#1d1230";
      x.fillRect(xx, yy, 1, 1);
    }
  x.fillStyle = "#3a2a4d";
  x.fillRect(0, gy, w, 1);
  // Each cabinet throws its own colour onto the floor in front of it.
  const spill = (ctx: CanvasRenderingContext2D, yOff: number, rows: number, onMain: boolean) =>
    cabs.forEach((cb) => {
      const cx = (cb.l + cb.r) / 2;
      const rx = (cb.r - cb.l) / 2 + 6;
      ctx.fillStyle = cb.acc || "#ff5470";
      ctx.globalAlpha = 0.42;
      for (let yy = 0; yy < rows; yy++)
        for (let xx = Math.floor(cb.l - 8); xx < cb.r + 8; xx++) {
          const ay = yOff + yy;
          const dens = Math.max(0, 0.6 - 0.6 * Math.hypot((xx - cx) / rx, (ay - (h - 2)) / 7));
          if (BAYER[ay & 3][xx & 3] / 16 < dens) ctx.fillRect(xx, yy + (onMain ? yOff : 0), 1, 1);
        }
      ctx.globalAlpha = 1;
    });
  spill(x, gy + 1, h - gy - 1, true);

  // Transition: the floor runs past the hero's edge and fades into the page as a
  // six-row ordered dither of single scene pixels, stepping toward the page colour.
  const band = hs.querySelector<HTMLCanvasElement>(".ha-band");
  if (band) {
    const bandH = 6;
    band.width = w;
    band.height = bandH;
    band.style.width = `${w * u}px`;
    band.style.height = `${bandH * u}px`;
    const b = band.getContext("2d")!;
    const pg = (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || ["244", "244", "247"])
      .slice(0, 3)
      .map(Number);
    const mix = (hex: string, f: number) => {
      const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
      return `rgb(${c.map((v, i) => Math.round(v + (pg[i] - v) * f)).join(",")})`;
    };
    const DENS = [0.88, 0.7, 0.5, 0.32, 0.16, 0.06];
    const FADE = [0.06, 0.2, 0.36, 0.52, 0.68, 0.82];
    for (let by = 0; by < bandH; by++)
      for (let bx = 0; bx < w; bx++) {
        if (BAYER[by & 3][bx & 3] / 16 >= DENS[by]) continue;
        b.fillStyle = mix(((bx >> 1) + ((h + by) >> 1)) & 1 ? "#170e24" : "#1d1230", FADE[by]);
        b.fillRect(bx, by, 1, 1);
      }
    spill(b, h, bandH, false);
  }

  // The torch rests on the bell tower; the hidden ghost waits in the doorway.
  const home: [number, number] = [(((sx + 21) * u) / W) * 100, (((sy + 10) * u) / H) * 100];
  const hid = hs.querySelector<HTMLElement>(".ha-hid");
  if (hid) {
    hid.style.left = `${(sx + 50) * u}px`;
    hid.style.top = `${(gy - 13) * u}px`;
  }
  const chalk = hs.querySelector<HTMLElement>(".ha-chalk");
  if (chalk) {
    chalk.style.left = `${(sx + 36) * u}px`;
    chalk.style.top = `${(gy + (phone ? 4 : 2)) * u}px`;
  }
  return home;
}

export function HauntedHero({
  games,
  competition,
  phone = false,
}: {
  /** The public, override-aware catalogue the page already holds. */
  games: Game[];
  /** Whether the competition is live. Decides the copy only. */
  competition: boolean;
  phone?: boolean;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const hs = ref.current;
    if (!hs) return;
    const html = document.documentElement;
    let home: [number, number] = [40, 30];
    let visible = true;
    let raf = 0;
    let disposed = false;
    let sprites: Promise<[HTMLImageElement | null, HTMLImageElement | null]> | null = null;

    const setTorch = (px: number, py: number) => {
      hs.style.setProperty("--tx", `${px}%`);
      hs.style.setProperty("--ty", `${py}%`);
    };
    const toPct = (cx: number, cy: number): [number, number] => {
      const r = hs.getBoundingClientRect();
      return [((cx - r.left) / r.width) * 100, ((cy - r.top) / r.height) * 100];
    };

    const paint = () => {
      if (!html.hasAttribute("data-hp-skin") || !hs.clientWidth) return;
      sprites ??= Promise.all([loadImage("school"), loadImage("trees")]);
      void sprites.then(([school, trees]) => {
        if (disposed || !html.hasAttribute("data-hp-skin") || !hs.clientWidth) return;
        home = paintScene(hs, school, trees, phone);
        setTorch(...home);
      });
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(paint);
    };

    paint();
    const ro = new ResizeObserver(schedule);
    ro.observe(hs);
    // The skin can be switched on, off or between Dark and Light without a reload.
    const mo = new MutationObserver(schedule);
    mo.observe(html, { attributes: true, attributeFilter: ["data-hp-skin", "data-theme"] });
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
    });
    io.observe(hs);

    // Pointer: follows only for a fine pointer, on screen, with motion allowed.
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");
    let lx = 0;
    let ly = 0;
    let moveRaf = 0;
    const onMove = (e: PointerEvent) => {
      if (!visible || phone || !fine.matches || motionOff()) return;
      lx = e.clientX;
      ly = e.clientY;
      if (!moveRaf)
        moveRaf = requestAnimationFrame(() => {
          moveRaf = 0;
          setTorch(...toPct(lx, ly));
        });
    };
    const onLeave = () => setTorch(...home);
    // Touch (and a fine pointer under reduced motion): the light jumps to the tap.
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest(".ha-cab, a, button")) return;
      if (fine.matches && !motionOff() && !phone) return;
      setTorch(...toPct(e.clientX, e.clientY));
    };
    // Keyboard: focus brings the light to the focused cabinet or the ghost.
    const onFocus = (e: FocusEvent) => {
      const el = (e.target as Element).closest?.(".ha-cab, .ha-hid");
      if (!el) return;
      const r = el.getBoundingClientRect();
      setTorch(...toPct(r.left + r.width / 2, r.top + r.height / 2));
    };
    hs.addEventListener("pointermove", onMove);
    hs.addEventListener("pointerleave", onLeave);
    hs.addEventListener("pointerdown", onDown);
    hs.addEventListener("focusin", onFocus);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      cancelAnimationFrame(moveRaf);
      ro.disconnect();
      mo.disconnect();
      io.disconnect();
      hs.removeEventListener("pointermove", onMove);
      hs.removeEventListener("pointerleave", onLeave);
      hs.removeEventListener("pointerdown", onDown);
      hs.removeEventListener("focusin", onFocus);
    };
  }, [phone]);

  const cabs = FRIGHT_FEST_GAMES.map((ff) => ({ ff, game: games.find((g) => g.slug === ff.slug) }));
  // On a phone lead with the games a phone can play.
  const ordered = phone
    ? [...cabs].sort((a, b) => Number(b.game?.platform !== "desktop") - Number(a.game?.platform !== "desktop"))
    : cabs;
  const practise = cabs.find((c) => c.game)?.game;

  return (
    <section
      ref={ref}
      className={`ha-deco ha-hero${phone ? " ph" : ""}`}
      data-ha-scene
      aria-label="Fright Fest"
    >
      <div className="ha-clip">
        <canvas className="ha-bg" aria-hidden="true" />
        <div className="ha-reveal">
          <span className="ha-chalk" aria-hidden="true">
            ROOM 000 →
          </span>
          <button
            type="button"
            className="ha-hid"
            data-ha-moment="doorway-ghost"
            aria-label="Something is standing in the doorway"
            onClick={() => window.dispatchEvent(new CustomEvent("hp:ghost-found"))}
          >
            <span aria-hidden="true" className="ha-spr ha-s-ghost" />
          </button>
        </div>
        <div className="ha-torch" aria-hidden="true" />
        <span className="ha-moon ha-spr" aria-hidden="true" />
      </div>

      <div className="ha-copy">
        <h2 className="ha-title">Fright Fest</h2>
        {competition ? (
          <p className="ha-line">
            <b>The arcade stayed open after dark.</b> Play the three haunted cabinets, earn Fright Points, and
            become the Fright Fest champion.
          </p>
        ) : (
          <p className="ha-line">
            <b>Three haunted cabinets, one champion.</b> Rewards to be announced.
          </p>
        )}
        <div className="ha-ctas">
          <Link href="/fright-fest" className="ha-btn" prefetch={false}>
            {competition ? "Enter Fright Fest" : "See how it works"}
          </Link>
          {!phone &&
            (competition ? (
              <Link href="/fright-fest#leaderboards" className="ha-link" prefetch={false}>
                Leaderboards
              </Link>
            ) : (
              practise && (
                <Link href={`/game/${practise.slug}`} className="ha-link" prefetch={false}>
                  Practise now
                </Link>
              )
            ))}
        </div>
        <p className="ha-when">
          <b>{competition ? `Ends ${LABELS.endsAt}` : LABELS.range}</b>
        </p>
      </div>

      <div className="ha-cabs">
        {ordered.map(({ ff, game }) => {
          const label = game ? `${game.title}: ${ff.short}` : `${ff.short}: coming soon`;
          const src = game ? coverImageSrc(game) : null;
          const inner = (
            <>
              <span className="mq">
                <span>
                  {ff.mq[0]}
                  <br />
                  {ff.mq[1]}
                </span>
              </span>
              <span className="scr">
                {src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt="" loading="lazy" decoding="async" style={{ objectPosition: ff.pos }} />
                )}
                {phone && game?.platform === "desktop" && <span className="pc">PC only</span>}
                {!game && (
                  <span className="off">
                    Coming
                    <br />
                    soon
                  </span>
                )}
              </span>
              <span className="body ha-spr" />
              <span className="lbl">{ff.short}</span>
            </>
          );
          const style = { "--acc": ff.acc } as CSSProperties;
          return game ? (
            <Link
              key={ff.slug}
              href={`/game/${ff.slug}`}
              prefetch={false}
              className="ha-cab"
              style={style}
              aria-label={label}
              title={label}
            >
              {inner}
            </Link>
          ) : (
            <span key={ff.slug} className="ha-cab" style={style} role="img" aria-label={label}>
              {inner}
            </span>
          );
        })}
      </div>
      <canvas className="ha-band" aria-hidden="true" />
    </section>
  );
}
