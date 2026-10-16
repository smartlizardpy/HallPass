// LAST BELL - atmosphere: fog, cold ambient/hemisphere light, background, chalkboard canvas text.
// Owned by S1 (World). Used by world.js; game.js does not need to import it.
import * as THREE from './lib/three/three.module.js';
import { QUALITY } from './config.js';

export const FOG_COLOR = 0x05070c;

export class Environment {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.name = 'environment';
    this.fog = new THREE.FogExp2(FOG_COLOR, 0.055);
    this.hemi = new THREE.HemisphereLight(0x46587a, 0x1c1814, 2.4);
    this.hemi.position.set(0, 10, 0);
    this.group.add(this.hemi);
    this.mode = 'normal';
    this.baseHemi = 2.4;
    this.target = 1;
    this.cur = 1;
    this.density = 0.055;
    this.built = false;
  }

  attach() {
    if (!this.group.parent) this.scene.add(this.group);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(FOG_COLOR);
    this.built = true;
  }

  /** Fog fades everything to near-black around QUALITY.drawDistance (corridors vanish ~20-30 m). */
  setQuality(q) {
    const Q = QUALITY[q] || QUALITY.medium;
    this.density = 1.9 / Q.drawDistance;
    this.fog.density = this.density;
  }

  setMode(mode) {
    this.mode = mode;
    this.target = { normal: 1, flicker: 0.9, dim: 0.6, red: 0.7, blackout: 0.35 }[mode] ?? 1;
  }

  update(dt) {
    this.cur += (this.target - this.cur) * Math.min(1, dt * 2);
    if (this.moon) this.moon.material.opacity = this.mode === 'blackout' ? 1.0 : 1.0;
    this.hemi.intensity = this.baseHemi * this.cur;
    if (this.mode === 'red') this.hemi.color.setHex(0x4e2a2e);
    else this.hemi.color.setHex(0x46587a);
  }

  /** Pale window-shaped moonlight on the floor under exterior windows. patches: [{x, z, rot}] */
  buildMoonlight(patches) {
    this.disposeMoonlight();
    if (!patches.length) return;
    if (!this._moonTex) {
      const c = document.createElement('canvas');
      c.width = 64; c.height = 32;
      const g = c.getContext('2d');
      g.fillStyle = '#000'; g.fillRect(0, 0, 64, 32);
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 2; j++) {
          const grd = g.createLinearGradient(0, j * 16, 0, j * 16 + 16);
          grd.addColorStop(0, 'rgba(190,205,235,1)');
          grd.addColorStop(1, 'rgba(120,135,170,1)');
          g.fillStyle = grd;
          g.fillRect(2 + i * 21, 2 + j * 15, 18, 12);
        }
      }
      this._moonTex = new THREE.CanvasTexture(c);
      this._moonTex.magFilter = THREE.NearestFilter;
      this._moonTex.minFilter = THREE.NearestFilter;
      this._moonTex.colorSpace = THREE.SRGBColorSpace;
    }
    const geo = new THREE.PlaneGeometry(2.9, 2.0);
    geo.rotateX(-Math.PI / 2);
    // skew: the far edge slides sideways (moon low in the sky, off to one side)
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) if (pos.getZ(i) > 0) pos.setX(i, pos.getX(i) + 0.7);
    const mat = new THREE.MeshBasicMaterial({
      map: this._moonTex, color: 0x26324c, transparent: true, blending: THREE.AdditiveBlending,
      depthWrite: false, fog: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8,
    });
    const mesh = new THREE.InstancedMesh(geo, mat, patches.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const one = new THREE.Vector3(1, 1, 1);
    patches.forEach((p, i) => {
      q.setFromAxisAngle(up, p.rot);
      m.compose(new THREE.Vector3(p.x, 0.012, p.z), q, one);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.renderOrder = 2;
    mesh.name = 'moonlight';
    this.moon = mesh;
    this.group.add(mesh);
  }

  disposeMoonlight() {
    if (!this.moon) return;
    this.group.remove(this.moon);
    this.moon.geometry.dispose();
    this.moon.material.dispose();
    this.moon.dispose();
    this.moon = null;
  }

  detach() {
    if (this.group.parent) this.group.parent.remove(this.group);
    if (this.scene.fog === this.fog) this.scene.fog = null;
  }
}

// ------------------------------------------------------------------------------------------- chalk text

/**
 * Draw chalk writing onto a canvas. baseImage = chalkboard texture image (ImageBitmap / img) or null.
 * style: 'chalk' (classroom board) | 'old' (Room 000 easel: huge 000 + tally marks)
 */
export function drawChalk(canvas, baseImage, text, style = 'chalk', seed = 1) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  let s = seed >>> 0 || 1;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  if (baseImage) {
    try { ctx.drawImage(baseImage, 0, 0, W, H); } catch { ctx.fillStyle = '#1f2b24'; ctx.fillRect(0, 0, W, H); }
  } else {
    ctx.fillStyle = '#1f2b24';
    ctx.fillRect(0, 0, W, H);
  }
  if (style === 'old') {
    ctx.fillStyle = 'rgba(10,8,6,0.35)';
    ctx.fillRect(0, 0, W, H);
  }
  const chalk = (a) => `rgba(222,226,212,${a})`;
  if (style === 'old') {
    ctx.font = `bold ${Math.floor(H * 0.52)}px "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = chalk(0.35 + 0.2 * k);
      ctx.fillText('000', W / 2 + (rnd() - 0.5) * 2, H * 0.38 + (rnd() - 0.5) * 2);
    }
    // tally marks
    ctx.strokeStyle = chalk(0.8);
    ctx.lineWidth = 1.5;
    let x = 6, y = H * 0.72;
    for (let g = 0; g < 14; g++) {
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        ctx.moveTo(x + i * 3, y - 7 + rnd() * 2);
        ctx.lineTo(x + i * 3 + rnd() - 0.5, y + 7);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(x - 2, y + 4);
      ctx.lineTo(x + 12, y - 5);
      ctx.stroke();
      x += 18;
      if (x > W - 16) { x = 6; y += 14; }
      if (y > H - 4) break;
    }
  } else {
    const lines = String(text).split('\n');
    const size = Math.floor(Math.min(H * 0.8 / lines.length, H * 0.32));
    ctx.font = `bold ${size}px "Comic Sans MS", "Chalkboard SE", "Marker Felt", cursive`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const top = H / 2 - ((lines.length - 1) * size * 1.1) / 2;
    lines.forEach((ln, i) => {
      const w = ctx.measureText(ln).width;
      const x = Math.max(4, (W - w) / 2 + (rnd() - 0.5) * W * 0.12);
      const y = top + i * size * 1.1;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate((rnd() - 0.5) * 0.06);
      ctx.fillStyle = chalk(0.25);
      ctx.fillText(ln, 1, 1);
      ctx.fillStyle = chalk(0.82);
      ctx.fillText(ln, 0, 0);
      ctx.restore();
    });
    // smudges
    ctx.fillStyle = 'rgba(200,205,190,0.06)';
    for (let k = 0; k < 6; k++) ctx.fillRect(rnd() * W, rnd() * H, 20 + rnd() * 40, 4 + rnd() * 6);
  }
  ctx.restore();
}
