#!/usr/bin/env node
/**
 * Generates the "SCP: LOCKDOWN CHAMPION" Fright Fest 2026 collectible card.
 *
 *   node scripts/generate-champion-card-scp-lockdown.mjs            render to a scratch dir, write nothing in public/
 *   node scripts/generate-champion-card-scp-lockdown.mjs --apply    write the art into public/collectibles/ff26/
 *
 * Original artwork, drawn here in SVG and rendered through sharp: a glowing red lockdown beacon on a
 * hazard-striped base. It copies none of the game's models or textures and shows no anomalies.
 * Layout and finish follow the other champion cards (title top, one hero, CHAMPION plaque, footer).
 * Encoding and naming follow scripts/catalogue-import.mjs (webp q86/effort 5, sha256 first 8 hex), so a
 * later studio import of the same PNG produces byte-identical hashed filenames.
 *
 * Output (in public/collectibles/ff26/): ff26-champion-scp-lockdown.png (source), .<hash8>.webp (750x1050),
 * -thumb.<hash8>.webp (300x420). Older hashed files of this card are removed on --apply.
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const OUT_DIR = APPLY ? join(ROOT, "public/collectibles/ff26") : join(ROOT, ".scratch-scp-lockdown");
const FONT = join(ROOT, "public/fonts/nunito-900.ttf");
const ID = "ff26-champion-scp-lockdown";
const W = 750;
const H = 1050;
const CX = 375;
const sha8 = (buf) => createHash("sha256").update(buf).digest("hex").slice(0, 8);

// ── Background + hero (SVG) ───────────────────────────────────────────────────
function rays(cx, cy, n, r) {
  let out = "";
  for (let i = 0; i < n; i += 2) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    out += `<polygon points="${cx},${cy} ${cx + r * Math.cos(a0)},${cy + r * Math.sin(a0)} ${cx + r * Math.cos(a1)},${cy + r * Math.sin(a1)}"/>`;
  }
  return out;
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
  <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#05080a"/><stop offset=".55" stop-color="#1c0b0f"/><stop offset="1" stop-color="#3a1014"/></linearGradient>
  <radialGradient id="glow" cx="375" cy="560" r="420" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#e5392d" stop-opacity=".85"/><stop offset=".45" stop-color="#e5392d" stop-opacity=".28"/><stop offset="1" stop-color="#e5392d" stop-opacity="0"/></radialGradient>
  <radialGradient id="dome" cx="330" cy="470" r="330" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#ffc2a8"/><stop offset=".3" stop-color="#ff6a50"/><stop offset=".7" stop-color="#e5392d"/><stop offset="1" stop-color="#8e1a1c"/></radialGradient>
  <linearGradient id="steel" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#8f9aa1"/><stop offset=".5" stop-color="#4d565c"/><stop offset="1" stop-color="#262c31"/></linearGradient>
  <linearGradient id="beam" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff7a5c" stop-opacity=".55"/><stop offset="1" stop-color="#ff7a5c" stop-opacity="0"/></linearGradient>
  <pattern id="dots" width="26" height="26" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><circle cx="13" cy="13" r="6" fill="#000"/></pattern>
  <linearGradient id="dotfade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".25"/><stop offset=".5" stop-color="#fff" stop-opacity=".45"/><stop offset="1" stop-color="#fff" stop-opacity=".85"/></linearGradient>
  <mask id="dotmask"><rect width="${W}" height="${H}" fill="url(#dotfade)"/></mask>
  <clipPath id="plate"><path d="M222 722 L528 722 L552 790 L198 790 Z"/></clipPath>
  <clipPath id="domeclip"><path d="M252 722 C252 540 300 372 375 372 C450 372 498 540 498 722 Z"/></clipPath>
</defs>
<rect width="${W}" height="${H}" fill="url(#bg)"/>
<g fill="#e5392d" opacity=".2">${rays(CX, 560, 36, 1100)}</g>
<rect width="${W}" height="${H}" fill="url(#glow)"/>
<rect width="${W}" height="${H}" fill="url(#dots)" mask="url(#dotmask)" opacity=".55"/>
<!-- vault-door panel seams behind the hero -->
<g stroke="#000" stroke-opacity=".35" stroke-width="6" fill="none"><line x1="120" y1="0" x2="120" y2="1050"/><line x1="630" y1="0" x2="630" y2="1050"/><line x1="0" y1="330" x2="750" y2="330" stroke-opacity=".2"/></g>
<g fill="#ff9a80" fill-opacity=".9" opacity=".95"><circle cx="64" cy="560" r="6"/><circle cx="686" cy="560" r="6"/></g>
<!-- light beams and sweep arcs -->
<polygon points="250,560 0,420 0,700" fill="url(#beam)"/>
<g transform="translate(750 0) scale(-1 1)"><polygon points="250,560 0,420 0,700" fill="url(#beam)"/></g>
<g fill="none" stroke="#ffd7c9" stroke-width="12" stroke-linecap="round" opacity=".92">
  <path d="M108 470 Q70 560 108 650"/><path d="M52 430 Q-6 560 52 690"/>
  <path d="M642 470 Q680 560 642 650"/><path d="M698 430 Q756 560 698 690"/>
</g>
<!-- beacon: base -->
<ellipse cx="${CX}" cy="852" rx="250" ry="30" fill="#000" opacity=".45"/>
<g stroke="#12060a" stroke-width="14" stroke-linejoin="round">
  <path d="M190 790 L560 790 L548 836 L202 836 Z" fill="url(#steel)"/>
  <path d="M222 722 L528 722 L552 790 L198 790 Z" fill="#f4c20d"/>
</g>
<g clip-path="url(#plate)"><g fill="#12060a">
  ${Array.from({ length: 9 }, (_, i) => `<polygon points="${170 + i * 46},790 ${200 + i * 46},790 ${240 + i * 46},722 ${210 + i * 46},722"/>`).join("")}
</g></g>
<g fill="#cfd6db" stroke="#12060a" stroke-width="4"><circle cx="232" cy="813" r="7"/><circle cx="518" cy="813" r="7"/></g>
<!-- beacon: dome -->
<path d="M252 722 C252 540 300 372 375 372 C450 372 498 540 498 722 Z" fill="url(#dome)"/>
<g clip-path="url(#domeclip)" stroke="#8e1a1c" stroke-opacity=".55" stroke-width="7" fill="none">
  <path d="M375 372 L375 722"/><path d="M375 372 C330 460 322 600 322 722"/><path d="M375 372 C420 460 428 600 428 722"/>
</g>
<path d="M252 722 C252 540 300 372 375 372 C450 372 498 540 498 722 Z" fill="none" stroke="#12060a" stroke-width="14" stroke-linejoin="round"/>
<ellipse cx="318" cy="500" rx="22" ry="70" fill="#fff" opacity=".7" transform="rotate(14 318 500)"/>
<circle cx="296" cy="590" r="9" fill="#fff" opacity=".6"/>
<rect x="340" y="340" width="70" height="40" rx="10" fill="url(#steel)" stroke="#12060a" stroke-width="12"/>
<!-- bottom floor shade -->
<rect y="905" width="${W}" height="145" fill="#05080a" opacity=".45"/>
</svg>`;

// ── Text helpers (Pango via sharp, using the repo's Nunito 900) ──────────────
async function textMask(text, size, spacing = 0) {
  const markup = `<span letter_spacing="${Math.round(spacing * 1024)}">${text}</span>`;
  const png = await sharp({
    text: { text: markup, font: `Nunito Black ${size}`, fontfile: FONT, dpi: 72, rgba: true, wrap: "none" },
  })
    .png()
    .toBuffer();
  return sharp(png).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
}

/** Filled alpha shape -> RGBA PNG of a flat colour (string) or a vertical gradient ([[offset, colour], ...]) with that alpha. */
async function solid(mask, w, h, fill) {
  const base = typeof fill === "string"
    ? sharp({ create: { width: w, height: h, channels: 3, background: fill } })
    : sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${fill.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join("")}</linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/></svg>`));
  const rgb = await base.removeAlpha().raw().toBuffer();
  const rgba = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = rgb[i * 3];
    rgba[i * 4 + 1] = rgb[i * 3 + 1];
    rgba[i * 4 + 2] = rgb[i * 3 + 2];
    rgba[i * 4 + 3] = mask[i];
  }
  return sharp(rgba, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
}

/** A heavy sticker-style title line: dark outline, yellow gradient face, offset shadow. Returns a PNG + size. */
async function titleLine(text, size) {
  const { data, info } = await textMask(text, size, 2);
  const pad = 40;
  const w = info.width + pad * 2;
  const h = info.height + pad * 2;
  const gray = async (img) => {
    const buf = await img.toColourspace("b-w").extractChannel(0).raw().toBuffer();
    if (buf.length !== w * h) throw new Error(`mask is ${buf.length} bytes, expected ${w * h}`);
    return buf;
  };
  const raw1 = (buf) => sharp(buf, { raw: { width: w, height: h, channels: 1 } });
  const padded = await gray(
    sharp(data, { raw: { width: info.width, height: info.height, channels: 1 } }).extend({ top: pad, bottom: pad, left: pad, right: pad, background: "#000" }),
  );
  // Thicken the face a touch, then grow it for the outline and again for the shadow.
  // sharp applies threshold before blur within one pipeline, so blur and threshold are separate passes.
  const grow = async (src, blur, thr) => gray(raw1(await gray(raw1(src).blur(blur))).threshold(thr));
  const faceMask = await grow(padded, 3, 110);
  const outline = await grow(padded, 12, 20);
  // Offset copy: shift down/right by padding the top/left, then crop back to the canvas (separate steps: sharp applies extract before extend).
  const shifted = await raw1(outline).extend({ top: 14, left: 10, background: "#000" }).toColourspace("b-w").extractChannel(0).raw().toBuffer();
  const shadowMask = await gray(sharp(shifted, { raw: { width: w + 10, height: h + 14, channels: 1 } }).extract({ left: 0, top: 0, width: w, height: h }));
  const layers = [
    { input: await solid(shadowMask, w, h, "#000"), left: 0, top: 0 },
    { input: await solid(outline, w, h, "#12060a"), left: 0, top: 0 },
    { input: await solid(faceMask, w, h, [[0, "#fff3b0"], [0.55, "#ffd23a"], [1, "#f5a31a"]]), left: 0, top: 0 },
  ];
  const png = await sharp({ create: { width: w, height: h, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(layers).png().toBuffer();
  return { png, w, h };
}

async function plainText(text, size, colour, spacing) {
  const { data, info } = await textMask(text, size, spacing);
  return { png: await solid(data, info.width, info.height, colour), w: info.width, h: info.height };
}

// ── Compose ──────────────────────────────────────────────────────────────────
async function render() {
  const bg = await sharp(Buffer.from(svg)).png().toBuffer();
  const composites = [];

  // Title: two tilted lines, slightly overlapping like the Shadow Core card.
  for (const [text, size, cy, deg] of [["SCP:", 175, 122, -3], ["LOCKDOWN", 140, 262, -3]]) {
    const t = await titleLine(text, size);
    const rotated = await sharp(t.png).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const m = await sharp(rotated).metadata();
    const maxW = W - 36;
    const buf = m.width > maxW ? await sharp(rotated).resize({ width: maxW }).png().toBuffer() : rotated;
    const mm = await sharp(buf).metadata();
    composites.push({ input: buf, left: Math.round((W - mm.width) / 2), top: Math.round(cy - mm.height / 2) });
  }

  // CHAMPION plaque
  const plaqueSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="420" height="84"><rect x="3" y="3" width="414" height="78" rx="14" fill="#1a0a0d" stroke="#ffd23a" stroke-width="5"/><rect x="11" y="11" width="398" height="62" rx="9" fill="none" stroke="#ffd23a" stroke-opacity=".35" stroke-width="2"/>${[[20, 20], [400, 20], [20, 64], [400, 64]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="4" fill="#ffd23a"/>`).join("")}</svg>`;
  composites.push({ input: Buffer.from(plaqueSvg), left: CX - 210, top: 868 });
  const champ = await plainText("CHAMPION", 46, "#ffe9a8", 9);
  composites.push({ input: champ.png, left: Math.round(CX - champ.w / 2 + 4), top: Math.round(868 + 42 - champ.h / 2) });

  // Footer
  const ff = await plainText("FRIGHT FEST 2026", 19, "#f2f2f2", 7);
  composites.push({ input: ff.png, left: Math.round(CX - ff.w / 2), top: 968 });
  const hp = await plainText("HALLPASS", 15, "#f2f2f2", 4);
  composites.push({ input: hp.png, left: CX - 8, top: 1005 });
  composites.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"><circle cx="7" cy="7" r="6" fill="#ffd23a"/></svg>`), left: CX - 34, top: 1009 });

  const body = await sharp(bg).composite(composites).png().toBuffer();

  // Rounded corners (transparent) and a steel border, like the other champion cards.
  const R = 30;
  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" rx="${R}" fill="#fff"/></svg>`;
  const borderSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><defs><linearGradient id="b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8eef2"/><stop offset=".5" stop-color="#8d979e"/><stop offset="1" stop-color="#d5dce0"/></linearGradient></defs><rect x="6" y="6" width="${W - 12}" height="${H - 12}" rx="${R - 6}" fill="none" stroke="url(#b)" stroke-width="12"/><rect x="13" y="13" width="${W - 26}" height="${H - 26}" rx="${R - 13}" fill="none" stroke="#12060a" stroke-opacity=".5" stroke-width="2"/></svg>`;
  return sharp(body)
    .composite([{ input: Buffer.from(borderSvg) }, { input: Buffer.from(maskSvg), blend: "dest-in" }])
    .png()
    .toBuffer();
}

const png = await render();
const art = await sharp(png).webp({ quality: 86, effort: 5 }).toBuffer();
const thumb = await sharp(png).resize(300, 420).webp({ quality: 82 }).toBuffer();
const artName = `${ID}.${sha8(art)}.webp`;
const thumbName = `${ID}-thumb.${sha8(thumb)}.webp`;

mkdirSync(OUT_DIR, { recursive: true });
if (APPLY) {
  for (const f of readdirSync(OUT_DIR)) if (f.startsWith(`${ID}.`) || f.startsWith(`${ID}-thumb.`)) rmSync(join(OUT_DIR, f));
}
writeFileSync(join(OUT_DIR, `${ID}.png`), png);
writeFileSync(join(OUT_DIR, artName), art);
writeFileSync(join(OUT_DIR, thumbName), thumb);
console.log(`${artName}  ${(art.length / 1024).toFixed(1)} KB\n${thumbName}  ${(thumb.length / 1024).toFixed(1)} KB\n-> ${OUT_DIR}`);
