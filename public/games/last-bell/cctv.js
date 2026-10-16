// LAST BELL - SCHOOLNET security cameras. Owned by the main agent.
//
// One fixed camera per corridor, high up at one end, looking down its length. While the Security
// Cameras app is open, schoolnet.js asks for one feed per frame (round-robin): it renders into a tiny
// render target, is read back and is drawn into a 2D canvas as grainy green night vision with a
// timestamp. The building's lights only follow the player, so a feed render turns the hemisphere
// light up (infra-red) and thins the fog for that one render; both are put back straight away.

import * as THREE from './lib/three/three.module.js';
import { CELL } from './config.js';

const W = 192;
const H = 144;
const IR_HEMI = 9; // hemisphere intensity during a feed render (normal is ~2.2)
const IR_FOG = 0.35; // fog density factor during a feed render

export class CCTV {
  constructor(game) {
    this.game = game;
    this.rigs = [];
    this.rt = new THREE.WebGLRenderTarget(W, H, { depthBuffer: true });
    this.cam = new THREE.PerspectiveCamera(74, W / H, 0.1, 60);
    this.cam.rotation.order = 'YXZ';
    this.pixels = new Uint8Array(W * H * 4);
    this._img = null;
  }

  /** One camera per corridor for the current layout (called after each generate). */
  build(world) {
    this.rigs = [];
    let n = 1;
    for (const room of world.rooms || []) {
      if (!room.isCorridor || !room.cells?.length) continue;
      // the two cells farthest apart: the camera hangs in one, looking towards the other
      let a = room.cells[0];
      let b = room.cells[0];
      let best = -1;
      for (const c1 of room.cells) {
        for (const c2 of room.cells) {
          const d = (c1.cx - c2.cx) ** 2 + (c1.cz - c2.cz) ** 2;
          if (d > best) {
            best = d;
            a = c1;
            b = c2;
          }
        }
      }
      const ax = a.cx * CELL + CELL / 2;
      const az = a.cz * CELL + CELL / 2;
      let dx = b.cx * CELL + CELL / 2 - ax;
      let dz = b.cz * CELL + CELL / 2 - az;
      let len = Math.hypot(dx, dz);
      if (len < 0.1) {
        dx = 1;
        dz = 0;
        len = 1;
      }
      const x = ax - (dx / len) * (CELL / 2 - 0.45);
      const z = az - (dz / len) * (CELL / 2 - 0.45);
      const reach = Math.min(len + CELL, 16);
      this.rigs.push({ id: n++, name: room.name, room, x, y: 2.85, z, yaw: Math.atan2(-dx, -dz), pitch: -Math.atan2(1.7, reach) });
    }
  }

  /** Render `rig` and draw it into `canvas` (a <canvas> element). */
  render(rig, canvas) {
    const g = this.game;
    const r = g.renderer;
    const scene = g.scene;
    if (!r || !scene || !rig || !canvas) return;
    const cam = this.cam;
    cam.position.set(rig.x, rig.y, rig.z);
    cam.rotation.set(rig.pitch, rig.yaw, 0);
    cam.updateMatrixWorld();
    const hemi = g.world?.env?.hemi;
    const hemiI = hemi ? hemi.intensity : 0;
    const fog = scene.fog;
    const fogD = fog && fog.density !== undefined ? fog.density : null;
    const prevRT = r.getRenderTarget();
    const prevClear = r.autoClear;
    try {
      if (hemi) hemi.intensity = IR_HEMI;
      if (fogD !== null) fog.density = fogD * IR_FOG;
      r.setRenderTarget(this.rt);
      r.autoClear = true;
      r.render(scene, cam);
      r.readRenderTargetPixels(this.rt, 0, 0, W, H, this.pixels);
    } catch (err) {
      console.warn('[cctv] feed failed', err);
    } finally {
      r.setRenderTarget(prevRT);
      r.autoClear = prevClear;
      if (hemi) hemi.intensity = hemiI;
      if (fogD !== null) fog.density = fogD;
    }
    this._draw(canvas, rig);
  }

  _draw(canvas, rig) {
    if (canvas.width !== W || canvas.height !== H) {
      canvas.width = W;
      canvas.height = H;
    }
    const ctx = canvas.getContext('2d');
    if (!this._img) this._img = ctx.createImageData(W, H);
    const d = this._img.data;
    const px = this.pixels;
    for (let y = 0; y < H; y++) {
      const sy = H - 1 - y; // render targets read bottom-up
      const dim = y % 2 ? 0.8 : 1;
      for (let x = 0; x < W; x++) {
        const si = (sy * W + x) * 4;
        const di = (y * W + x) * 4;
        let l = (px[si] * 0.3 + px[si + 1] * 0.59 + px[si + 2] * 0.11) / 255;
        l = Math.sqrt(l) * 1.25 + (Math.random() - 0.5) * 0.14;
        l = Math.max(0, Math.min(1, l * dim));
        d[di] = l * 125;
        d[di + 1] = 30 + l * 225;
        d[di + 2] = l * 110;
        d[di + 3] = 255;
      }
    }
    ctx.putImageData(this._img, 0, 0);
    // a rolling interference bar
    const t = performance.now() / 1000;
    ctx.fillStyle = 'rgba(200,255,200,0.06)';
    ctx.fillRect(0, ((t * 37) % (H + 20)) - 20, W, 9);
    ctx.font = '10px "Courier Prime", monospace';
    ctx.fillStyle = '#c8ffc0';
    ctx.fillText(`CAM ${String(rig.id).padStart(2, '0')}  ${String(rig.name).toUpperCase()}`, 6, 13);
    const s = Math.floor(this.game.time || 0);
    const clock = `03:${String(33 + Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    ctx.fillText(clock, 6, H - 6);
    if (Math.floor(t * 2) % 2) {
      ctx.fillStyle = '#ff3b3b';
      ctx.beginPath();
      ctx.arc(W - 30, 10, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#c8ffc0';
      ctx.fillText('REC', W - 24, 13);
    }
  }

  dispose() {
    this.rt.dispose();
  }
}
