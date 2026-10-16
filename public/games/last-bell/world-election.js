// LAST BELL - the student council election: campaign posters and a banner in reception.
// Owned by the main agent. Candidates live in election.js.
//
// Posters: the school's posters all share one texture (m_posters). This replaces it with a 1024 px
// sheet of 4x4 designs: the four original school posters (scaled up with nearest filtering), the
// printed candidate posters and one hand-made poster per write-in variant. Every poster the room
// dressing hangs picks a design with pickPosterDesign(x, z) (deterministic per spot, weighted) and
// points its UVs at that slot (placement.uvTo, remapped by the kit's StaticBatcher).
// Banner: a double-sided cloth banner hung across reception, above the caretaker's head.

import * as THREE from './lib/three/three.module.js';
import { WALL_HEIGHT } from './config.js';
import { addVertexSnap } from './assets.js';
import { ELECTION } from './election.js';

const ATLAS = 1024;
const Q = 256; // one poster slot
const GRID = ATLAS / Q; // 4 x 4
const INSET = 3 / ATLAS; // keep mipmaps from bleeding between slots

// glTF UVs: v = 0 is the top of the image, so slots map straight onto the canvas.
// Originals come from the kit's 128 px sheet (64 px each).
const ORIGINALS = [
  { id: 'be-quiet', src: [64, 0], weight: 1.0 },
  { id: 'dont-run', src: [64, 64], weight: 0.7 },
  { id: 'you-are-here', src: [0, 0], weight: 0.4 },
  { id: 'elements', src: [0, 64], weight: 0.4 },
];

/** Every design on the sheet, in slot order. */
export const POSTER_DESIGNS = (() => {
  const out = ORIGINALS.map((o) => ({ ...o, kind: 'original', campaign: false }));
  for (const c of ELECTION.candidates) {
    if (c.style === 'handmade') {
      const variants = c.variants?.length ? c.variants : [{}];
      for (const v of variants) out.push({ id: 'writein', kind: 'handmade', campaign: true, cand: c, variant: v, weight: (c.weight ?? 3) / variants.length });
    } else out.push({ id: c.name, kind: 'printed', campaign: true, cand: c, weight: c.weight ?? 1.6 });
  }
  return out.slice(0, GRID * GRID).map((d, i) => {
    const col = i % GRID;
    const row = Math.floor(i / GRID);
    return { ...d, slot: i, x: col * Q, y: row * Q, uvTo: [col / GRID + INSET, row / GRID + INSET, (col + 1) / GRID - INSET, (row + 1) / GRID - INSET] };
  });
})();
const TOTAL_WEIGHT = POSTER_DESIGNS.reduce((a, d) => a + d.weight, 0);

/** Which design hangs at (x, z): stable for a spot, weighted, independent of the dressing RNG. */
export function pickPosterDesign(x, z) {
  const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
  let t = h * TOTAL_WEIGHT;
  for (const d of POSTER_DESIGNS) {
    t -= d.weight;
    if (t <= 0) return d;
  }
  return POSTER_DESIGNS[POSTER_DESIGNS.length - 1];
}
const MARKER = "'Marker Felt', 'Chalkboard SE', 'Comic Sans MS', 'Segoe Print', 'Bradley Hand', cursive";
const FONT = "'Barlow Condensed', 'Arial Narrow', 'Helvetica Neue', Arial, sans-serif";
const BANNER_W = 3.2;
const BANNER_H = 0.42;
const BANNER_BOTTOM = 2.74;

export class ElectionPosters {
  constructor(world) {
    this.world = world;
    this.banner = null;
    this._photos = new Map();
    this.canvas = null;
    this.texture = null;
    this.bannerCanvas = null;
    this.bannerMat = null;
  }

  // ------------------------------------------------------------------------------ posters
  /** Call once the kit has loaded. Photos load in the background and redraw when ready. */
  applyPosters() {
    const mat = this.world.kit?.materials?.get('m_posters');
    const old = mat?.map;
    if (!mat || !old?.image) return;
    this._source = old.image;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = ATLAS;
    const tex = new THREE.CanvasTexture(this.canvas);
    tex.flipY = old.flipY;
    tex.colorSpace = old.colorSpace;
    tex.wrapS = old.wrapS;
    tex.wrapT = old.wrapT;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter; // names stay readable a few metres away
    tex.anisotropy = 4;
    this.texture = tex;
    this._drawAtlas();
    mat.map = tex;
    mat.needsUpdate = true;
    old.dispose?.();
    // fonts and photos arrive later: redraw then
    const redraw = () => this._drawAtlas();
    try { document.fonts?.load(`700 60px ${FONT}`).then(redraw, () => {}); } catch { /* ignore */ }
    const photos = new Set();
    for (const d of POSTER_DESIGNS) {
      const p = d.variant?.photo ?? d.cand?.photo;
      if (p) photos.add(p);
    }
    for (const p of photos) {
      if (this._photos.has(p)) continue;
      const img = new Image();
      this._photos.set(p, null);
      img.onload = () => { this._photos.set(p, img); redraw(); };
      img.onerror = () => console.warn('[election] photo not found:', p);
      img.src = (this.world.game?.assetBase || '') + p;
    }
  }

  _drawAtlas() {
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true }); // photo posterising reads pixels back
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, ATLAS, ATLAS);
    for (const d of POSTER_DESIGNS) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.beginPath();
      ctx.rect(0, 0, Q, Q);
      ctx.clip();
      if (d.kind === 'original') {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(this._source, d.src[0], d.src[1], 64, 64, 0, 0, Q, Q);
        ctx.imageSmoothingEnabled = true;
      } else if (d.kind === 'handmade') {
        const c = { ...d.cand, ...d.variant };
        drawHandmade(ctx, c, this._photos.get(c.photo) || null);
      } else drawPoster(ctx, d.cand, this._photos.get(d.cand.photo) || null);
      ctx.restore();
    }
    if (this.texture) this.texture.needsUpdate = true;
  }

  // ------------------------------------------------------------------------------ banner
  clearBanner() {
    if (!this.banner) return;
    this.world.root.remove(this.banner);
    this.banner.geometry.dispose();
    this.banner = null;
  }

  /** After a SCHOOLNET vote: the reception banner announces the (rigged) result. */
  showResults() {
    this.results = true;
    if (!this.bannerCanvas || !this.bannerMat?.map) return;
    drawBanner(this.bannerCanvas.getContext('2d'), this.bannerCanvas.width, this.bannerCanvas.height, true);
    this.bannerMat.map.needsUpdate = true;
  }

  /** Hang the banner across reception (called after each generate). */
  placeBanner() {
    this.clearBanner();
    if (this.results && this.bannerCanvas) {
      // a new run: back to the campaign banner
      this.results = false;
      drawBanner(this.bannerCanvas.getContext('2d'), this.bannerCanvas.width, this.bannerCanvas.height);
      if (this.bannerMat?.map) this.bannerMat.map.needsUpdate = true;
    }
    const room = this.world.rooms?.find((r) => r.type === 'reception');
    if (!room) return;
    if (!this.bannerMat) {
      this.bannerCanvas = document.createElement('canvas');
      this.bannerCanvas.width = 1024;
      this.bannerCanvas.height = Math.round((1024 * BANNER_H) / BANNER_W);
      drawBanner(this.bannerCanvas.getContext('2d'), this.bannerCanvas.width, this.bannerCanvas.height);
      const tex = new THREE.CanvasTexture(this.bannerCanvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      this.bannerMat = addVertexSnap(new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide, emissive: 0x1c1c1c, emissiveMap: tex }));
      try {
        document.fonts?.load(`700 60px ${FONT}`).then(() => {
          drawBanner(this.bannerCanvas.getContext('2d'), this.bannerCanvas.width, this.bannerCanvas.height, this.results);
          tex.needsUpdate = true;
        }, () => {});
      } catch { /* ignore */ }
    }
    const b = room.bounds;
    const alongX = b.maxX - b.minX >= b.maxZ - b.minZ;
    const span = Math.min(BANNER_W, (alongX ? b.maxX - b.minX : b.maxZ - b.minZ) - 0.6);
    const geo = new THREE.PlaneGeometry(span, BANNER_H, 8, 1);
    // a gentle sag along the banner
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = pos.getX(i) / (span / 2);
      pos.setY(i, pos.getY(i) - 0.06 * (1 - t * t));
      pos.setZ(i, 0.02 * Math.sin(t * 3.1));
    }
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, this.bannerMat);
    mesh.name = 'election-banner';
    mesh.position.set((b.minX + b.maxX) / 2, Math.min(WALL_HEIGHT - BANNER_H / 2 - 0.04, BANNER_BOTTOM + BANNER_H / 2 + 0.06), (b.minZ + b.maxZ) / 2);
    mesh.rotation.y = alongX ? 0 : Math.PI / 2;
    this.banner = mesh;
    this.world.root.add(mesh);
  }
}

// ---------------------------------------------------------------------------------- drawing
function fitText(ctx, text, weight, size, maxW, min = 12) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  while (size > min && ctx.measureText(text).width > maxW) {
    size -= 1;
    ctx.font = `${weight} ${size}px ${FONT}`;
  }
  return size;
}

/** One campaign poster, Q x Q px, origin at its top-left. */
function drawPoster(ctx, c, photo) {
  const ink = '#f4efe2';
  ctx.fillStyle = c.color || '#1f4f8f';
  ctx.fillRect(0, 0, Q, Q);
  // print texture: faint diagonal stripes
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 6;
  for (let k = -Q; k < Q * 2; k += 18) {
    ctx.beginPath();
    ctx.moveTo(k, 0);
    ctx.lineTo(k + Q, Q);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // VOTE + office
  ctx.fillStyle = ink;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  fitText(ctx, 'VOTE', 700, 70, Q - 28);
  ctx.fillText('VOTE', 14, 62);
  const office = (ELECTION.office || '').toUpperCase();
  fitText(ctx, office, 600, 17, Q - 28, 10);
  ctx.globalAlpha = 0.85;
  ctx.fillText(office, 15, 82);
  ctx.globalAlpha = 1;

  // portrait
  const px = 14;
  const py = 92;
  const pw = 104;
  const ph = 118;
  ctx.fillStyle = ink;
  ctx.fillRect(px - 4, py - 4, pw + 8, ph + 8);
  ctx.save();
  ctx.beginPath();
  ctx.rect(px, py, pw, ph);
  ctx.clip();
  if (photo) drawPhoto(ctx, photo, px, py, pw, ph);
  else drawFace(ctx, c.look || {}, px, py, pw, ph, c.color);
  ctx.restore();

  // name (first / last on two lines) + slogan
  const parts = String(c.name || '').trim().split(/\s+/);
  const first = parts.length > 1 ? parts.slice(0, -1).join(' ') : parts[0] || '';
  const last = parts.length > 1 ? parts[parts.length - 1] : '';
  const nx = px + pw + 12;
  const nw = Q - nx - 10;
  ctx.fillStyle = ink;
  fitText(ctx, first.toUpperCase(), 700, 36, nw, 14);
  ctx.fillText(first.toUpperCase(), nx, py + 32);
  if (last) {
    fitText(ctx, last.toUpperCase(), 700, 36, nw, 14);
    ctx.fillText(last.toUpperCase(), nx, py + 66);
  }
  ctx.font = `italic 500 15px ${FONT}`;
  wrap(ctx, c.slogan || '', nx, py + 90, nw, 17, 3);

  // ballot strip
  ctx.fillStyle = ink;
  ctx.fillRect(0, Q - 34, Q, 34);
  ctx.fillStyle = c.color || '#1f4f8f';
  ctx.strokeStyle = c.color || '#1f4f8f';
  ctx.lineWidth = 3;
  ctx.strokeRect(14, Q - 27, 20, 20);
  ctx.beginPath();
  ctx.moveTo(17, Q - 17);
  ctx.lineTo(23, Q - 11);
  ctx.lineTo(37, Q - 31);
  ctx.stroke();
  fitText(ctx, (ELECTION.when || '').toUpperCase(), 700, 22, Q - 60, 12);
  ctx.textBaseline = 'middle';
  ctx.fillText((ELECTION.when || '').toUpperCase(), 46, Q - 16);
  ctx.textBaseline = 'alphabetic';

  if (c.graffiti) drawGraffiti(ctx, px, py, pw, ph, !!photo);
}

function wrap(ctx, text, x, y, maxW, lineH, maxLines) {
  const words = String(text).split(/\s+/);
  let line = '';
  let n = 0;
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + ' ' + words[i] : words[i];
    if (ctx.measureText(test).width > maxW && line) {
      ctx.fillText(line, x, y + n * lineH);
      n++;
      line = words[i];
      if (n >= maxLines) return;
    } else line = test;
  }
  if (line && n < maxLines) ctx.fillText(line, x, y + n * lineH);
}

/** Photo, cover-fitted and posterised so it looks printed on the same cheap poster. */
function drawPhoto(ctx, img, x, y, w, h) {
  const s = Math.max(w / img.width, h / img.height);
  const dw = img.width * s;
  const dh = img.height * s;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  try {
    const d = ctx.getImageData(x, y, w, h);
    const a = d.data;
    for (let i = 0; i < a.length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const v = Math.min(255, Math.max(0, (a[i + k] - 128) * 1.08 + 128));
        a[i + k] = Math.round(v / 17) * 17; // a little banding, like a cheap colour print
      }
    }
    ctx.putImageData(d, x, y);
  } catch { /* tainted canvas: leave the photo as is */ }
}

/** Simple school-photo portrait: blazer, collar, tie, face, hair.
 *  look: { skin, hair, hairStyle: 'short'|'long', highlights?, liner?, earrings?, lips?, blazer } */
function drawFace(ctx, look, x, y, w, h, tie) {
  const skin = look.skin || '#c99a73';
  const hair = look.hair || '#2a1a12';
  const blazer = look.blazer || '#22263a';
  const long = look.hairStyle === 'long';
  const hairFill = (top, bottom) => {
    if (!look.highlights) return hair;
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, hair);
    g.addColorStop(0.45, hair);
    g.addColorStop(1, look.highlights);
    return g;
  };
  ctx.fillStyle = '#8fa3b5'; // photo backdrop
  ctx.fillRect(x, y, w, h);
  const cx = x + w / 2;
  // long hair behind the shoulders (balayage towards the ends if highlights are set)
  if (long) {
    ctx.fillStyle = hairFill(y + h * 0.2, y + h * 0.95);
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.55, w * 0.33, h * 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // shoulders / blazer
  ctx.fillStyle = blazer;
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 1.02, w * 0.5, h * 0.3, 0, 0, Math.PI * 2);
  ctx.fill();
  // shirt collar + tie
  ctx.fillStyle = '#eeeae0';
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.14, y + h * 0.74);
  ctx.lineTo(cx + w * 0.14, y + h * 0.74);
  ctx.lineTo(cx, y + h * 0.92);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = tie || '#a3172f';
  ctx.fillRect(cx - 4, y + h * 0.78, 8, h * 0.22);
  // neck + head
  ctx.fillStyle = skin;
  ctx.fillRect(cx - w * 0.08, y + h * 0.6, w * 0.16, h * 0.16);
  ctx.beginPath();
  ctx.ellipse(cx, y + h * 0.45, w * 0.21, h * 0.22, 0, 0, Math.PI * 2);
  ctx.fill();
  // hair on top: middle part with long front pieces framing the face, or a short cut
  ctx.fillStyle = hairFill(y + h * 0.2, y + h * 0.95);
  if (long) {
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.35, w * 0.24, h * 0.15, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + s * w * 0.02, y + h * 0.24);
      ctx.quadraticCurveTo(cx + s * w * 0.2, y + h * 0.28, cx + s * w * 0.25, y + h * 0.5);
      ctx.lineTo(cx + s * w * 0.27, y + h * 0.8);
      ctx.lineTo(cx + s * w * 0.18, y + h * 0.78);
      ctx.quadraticCurveTo(cx + s * w * 0.17, y + h * 0.42, cx + s * w * 0.06, y + h * 0.3);
      ctx.closePath();
      ctx.fill();
    }
  } else {
    ctx.beginPath();
    ctx.ellipse(cx, y + h * 0.33, w * 0.23, h * 0.13, 0, Math.PI, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - w * 0.23, y + h * 0.32, w * 0.46, h * 0.05);
  }
  // small gold hoops, peeking out under the hair
  if (look.earrings) {
    ctx.strokeStyle = '#e0bb4f';
    ctx.lineWidth = 2.2;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + s * w * 0.19, y + h * 0.6, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // eyes: plain dots, or almond eyes with a winged liner
  const ey = y + h * 0.445;
  if (look.liner) {
    ctx.fillStyle = '#16100c';
    ctx.strokeStyle = '#16100c';
    ctx.lineWidth = 1.6;
    for (const s of [-1, 1]) {
      const ex = cx + s * w * 0.085;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 4.2, 2.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(ex + s * 3.5, ey - 1);
      ctx.lineTo(ex + s * 7.5, ey - 3.6);
      ctx.stroke();
    }
  } else {
    ctx.fillStyle = '#1a1410';
    ctx.fillRect(cx - w * 0.09, ey - 1, 4, 4);
    ctx.fillRect(cx + w * 0.09 - 4, ey - 1, 4, 4);
  }
  // a school-photo smile
  ctx.strokeStyle = look.lips || '#5a2e22';
  ctx.lineWidth = look.lips ? 2.6 : 2;
  ctx.beginPath();
  ctx.arc(cx, y + h * 0.5, w * 0.065, 0.22 * Math.PI, 0.78 * Math.PI);
  ctx.stroke();
}

/** Black marker: a moustache (drawn portraits only), and "000" scrawled next to VOTE. */
function drawGraffiti(ctx, x, y, w, h, photo) {
  ctx.save();
  ctx.strokeStyle = '#111';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (!photo) {
    const cx = x + w / 2;
    const my = y + h * 0.53;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(cx - 16, my + 3);
    ctx.quadraticCurveTo(cx - 8, my - 6, cx, my - 1);
    ctx.quadraticCurveTo(cx + 8, my - 6, cx + 16, my + 3);
    ctx.stroke();
  }
  ctx.font = `700 30px 'Courier Prime', 'Courier New', monospace`;
  ctx.fillStyle = 'rgba(12,10,10,0.88)';
  ctx.font = `700 40px 'Courier Prime', 'Courier New', monospace`;
  ctx.translate(Q - 96, 54);
  ctx.rotate(-0.16);
  ctx.fillText('000', 0, 0);
  ctx.restore();
}

/** A write-in candidate's poster: marker on lined paper, taped up crooked. */
function drawHandmade(ctx, c, photo) {
  // paper with notebook lines and a red margin
  ctx.fillStyle = '#f3efe2';
  ctx.fillRect(0, 0, Q, Q);
  ctx.strokeStyle = 'rgba(70,110,170,0.25)';
  ctx.lineWidth = 1.5;
  for (let y = 30; y < Q; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(Q, y);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(200,60,60,0.35)';
  ctx.beginPath();
  ctx.moveTo(26, 0);
  ctx.lineTo(26, Q);
  ctx.stroke();
  // tape on the corners
  ctx.fillStyle = 'rgba(245,240,215,0.7)';
  for (const [x, y, r] of [[18, 6, -0.6], [Q - 18, 6, 0.6]]) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(r);
    ctx.fillRect(-18, -7, 36, 14);
    ctx.restore();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // VOTE!!! in red marker, a bit wonky
  ctx.save();
  ctx.translate(photo ? 78 : Q / 2, photo ? 58 : 52);
  ctx.rotate(-0.05);
  ctx.fillStyle = '#c1121f';
  ctx.font = `bold ${photo ? 40 : 50}px ${MARKER}`;
  ctx.fillText('VOTE!!!', 0, 0);
  ctx.restore();
  if (photo) drawPolaroid(ctx, photo, Q - 98, 10, 0.07);
  // the name, one marker colour per line
  const lines = (c.lines && c.lines.length ? c.lines : String(c.name || '').split(/\s+/)).map((l) => l.toUpperCase());
  const inks = ['#111111', '#1b4fa0', '#111111', '#1f7a3a', '#111111'];
  const top = photo ? 104 : 74;
  const lh = Math.min(34, (Q - top - (c.slogan ? 60 : 50)) / Math.max(1, lines.length));
  lines.forEach((l, i) => {
    ctx.save();
    ctx.translate(Q / 2 + (i % 2 ? 4 : -3), top + lh * (i + 0.75));
    ctx.rotate(i % 2 ? 0.025 : -0.02);
    ctx.fillStyle = inks[i % inks.length];
    let size = lh * 0.95;
    ctx.font = `bold ${size}px ${MARKER}`;
    while (size > 10 && ctx.measureText(l).width > Q - 26) {
      size -= 1;
      ctx.font = `bold ${size}px ${MARKER}`;
    }
    ctx.fillText(l, 0, 0);
    ctx.restore();
  });
  // the slogan, in quotes, scribbled smaller
  if (c.slogan) {
    ctx.save();
    ctx.translate(Q / 2, Q - 42);
    ctx.rotate(-0.03);
    ctx.fillStyle = '#2b2b2b';
    const text = `"${c.slogan}"`;
    let size = 19;
    ctx.font = `${size}px ${MARKER}`;
    while (size > 10 && ctx.measureText(text).width > Q - 30) {
      size -= 1;
      ctx.font = `${size}px ${MARKER}`;
    }
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }
  // FOR PRESIDENT + stars + a little crown doodle
  ctx.save();
  ctx.translate(Q / 2, Q - 12);
  ctx.rotate(0.03);
  ctx.fillStyle = '#c1121f';
  ctx.font = `bold 22px ${MARKER}`;
  ctx.fillText('★ FOR PRESIDENT ★', 0, 0);
  ctx.restore();
  ctx.save();
  if (photo) {
    ctx.translate(Q - 58, 4); // doodled onto the photo, on his head
    ctx.rotate(0.07);
  } else ctx.translate(Q - 30, 50);
  ctx.strokeStyle = '#d4a017';
  ctx.lineWidth = 3;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(-22, 20);
  ctx.lineTo(-18, 4);
  ctx.lineTo(-8, 14);
  ctx.lineTo(0, 0);
  ctx.lineTo(8, 14);
  ctx.lineTo(18, 4);
  ctx.lineTo(22, 20);
  ctx.closePath();
  ctx.stroke();
  ctx.restore();
}

/** A printed photo taped onto the paper, polaroid style. */
function drawPolaroid(ctx, img, x, y, rot) {
  const w = 88;
  const h = 98;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  ctx.rotate(rot);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-w / 2 + 3, -h / 2 + 3, w, h);
  ctx.fillStyle = '#fbfaf5';
  ctx.fillRect(-w / 2, -h / 2, w, h);
  const ps = w - 10;
  ctx.save();
  ctx.beginPath();
  ctx.rect(-ps / 2, -h / 2 + 5, ps, ps);
  ctx.clip();
  const s = Math.max(ps / img.width, ps / img.height);
  ctx.drawImage(img, -img.width * s / 2, -h / 2 + 5 + ps / 2 - img.height * s / 2, img.width * s, img.height * s);
  ctx.restore();
  ctx.fillStyle = 'rgba(245,240,215,0.75)'; // tape
  ctx.fillRect(-16, -h / 2 - 6, 32, 12);
  ctx.restore();
}

function drawBanner(ctx, W, H, results = false) {
  const cs = ELECTION.candidates.filter((c) => c.style !== 'handmade'); // the official banner ignores write-ins
  ctx.fillStyle = '#f0ebdc';
  ctx.fillRect(0, 0, W, H);
  // candidate colour stripes top and bottom
  const n = Math.max(1, cs.length);
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = cs[i]?.color || '#1f4f8f';
    ctx.fillRect((W / n) * i, 0, W / n, 16);
    ctx.fillRect((W / n) * i, H - 16, W / n, 16);
  }
  const text = (results ? 'Results are in: Tövbe wins (99.7%)' : ELECTION.banner || 'Student Council Election').toUpperCase();
  ctx.fillStyle = results ? '#7a1010' : '#1d2433';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, text, 700, 78, W - 60, 20);
  ctx.fillText(text, W / 2, H / 2 + 2);
}
