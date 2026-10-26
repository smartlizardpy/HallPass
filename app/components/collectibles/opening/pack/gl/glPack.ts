/**
 * The foil pack in WebGL: one canvas, two meshes (body and strip), one shader
 * program, four small textures (print, material, normals, torn edge).
 *
 * It draws only while something moves: every input sets spring targets and
 * wakes the loop; when every spring is at rest and nothing is flying, the loop
 * stops. It also stops while the tab is hidden. Device pixel ratio is capped
 * (2, or 1.5 on modest hardware) and lowered further if frames run long.
 * `destroy()` releases every GL object and the context.
 */

import { TEAR, emptyTear, type Tear } from "../../tear";
import { packArt, PACK_ASPECT } from "../art";
import { bendParts, createParts, STRIDE, type Bend, type Part } from "../mesh";
import { snap, spring, step, type Spring } from "../springs";
import { normalMap } from "../surface";
import type { PackRenderer, RendererOptions } from "../types";
import { apply, camera, chain, normalMatrix, rotationX, rotationY, rotationZ, translation, type Mat4 } from "./mat4";
import { FRAGMENT, VERTEX } from "./shaders";

const SEAM_TEX = 256;
const SEAM_MIN = TEAR.seamMinV - 0.03;
const SEAM_SPAN = TEAR.seamMaxV + 0.03 - SEAM_MIN;
/** The camera sits this many pack widths away: about CSS perspective 1000px for a 280px pack. */
const CAMERA_DIST = 3.6;
const DEG = Math.PI / 180;

interface Flight {
  t: number;
  pos: [number, number, number];
  vel: [number, number, number];
  rot: [number, number, number];
  spin: [number, number, number];
  pivot: [number, number, number];
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

/** Whether this browser can give us a WebGL context at all (cheap; the probe context is released). */
export function webglAvailable(): boolean {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl") ?? (c.getContext("experimental-webgl") as WebGLRenderingContext | null);
    if (!gl) return false;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

export async function createGLPack(canvas: HTMLCanvasElement, packId: string, seed: number, opts: RendererOptions): Promise<PackRenderer | null> {
  const ctx = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true, depth: true, powerPreference: "default" });
  if (!ctx) return null;
  const gl: WebGLRenderingContext = ctx;

  const modest = (navigator.hardwareConcurrency ?? 8) <= 4 || ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) <= 4;
  let dprCap = modest ? 1.5 : 2;
  let dpr = Math.min(window.devicePixelRatio || 1, dprCap);

  let program: WebGLProgram;
  try {
    program = gl.createProgram()!;
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) ?? "link");
  } catch (e) {
    console.warn("pack: WebGL shader failed, using the fallback", e);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return null;
  }
  gl.useProgram(program);
  const loc = (n: string) => gl.getUniformLocation(program, n);
  const U = {
    model: loc("uModel"),
    normalMat: loc("uNormalMat"),
    viewProj: loc("uViewProj"),
    colour: loc("uColour"),
    material: loc("uMaterial"),
    normal: loc("uNormal"),
    seam: loc("uSeam"),
    part: loc("uPart"),
    torn: loc("uTorn"),
    seamRange: loc("uSeamRange"),
    eye: loc("uEye"),
    light: loc("uLight"),
    alpha: loc("uAlpha"),
    bump: loc("uBump"),
    aspect: loc("uAspect"),
    exposure: loc("uExposure"),
    room: loc("uRoom"),
  };
  const A = { pos: gl.getAttribLocation(program, "aPos"), nrm: gl.getAttribLocation(program, "aNrm"), tan: gl.getAttribLocation(program, "aTan"), uv: gl.getAttribLocation(program, "aUv") };

  // ── Textures ──
  const texture = (unit: number) => {
    const t = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  };
  const tex = { colour: texture(0), material: texture(1), normal: texture(2), seam: texture(3) };
  gl.uniform1i(U.colour, 0);
  gl.uniform1i(U.material, 1);
  gl.uniform1i(U.normal, 2);
  gl.uniform1i(U.seam, 3);

  let artWidth = 0;
  let disposed = false;
  async function uploadArt(packPx: number) {
    const want = Math.min(900, Math.round(packPx * dpr));
    if (Math.abs(want - artWidth) < want * 0.15) return;
    artWidth = want;
    const art = await packArt(packId, want);
    if (disposed) return;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex.colour);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art.colour);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, tex.material);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art.material);
    const nm = normalMap(Math.min(512, Math.round(want * 0.75)), seed);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, tex.normal);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, nm.width, nm.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, nm.data);
    ready = true;
    wake();
  }

  const seamBytes = new Uint8Array(SEAM_TEX);
  function uploadSeam(seam: Float32Array) {
    for (let i = 0; i < SEAM_TEX; i++) {
      const x = (i / (SEAM_TEX - 1)) * (seam.length - 1);
      const j = Math.floor(x);
      const f = x - j;
      const v = seam[j] * (1 - f) + seam[Math.min(j + 1, seam.length - 1)] * f;
      seamBytes[i] = Math.round(Math.min(1, Math.max(0, (v - SEAM_MIN) / SEAM_SPAN)) * 255);
    }
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, tex.seam);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, SEAM_TEX, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, seamBytes);
  }

  // ── Geometry ──
  const parts = createParts();
  const buffers = new Map<Part, { vbo: WebGLBuffer; ibo: WebGLBuffer }>();
  for (const p of [parts.body, parts.strip]) {
    const vbo = gl.createBuffer()!;
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, p.index, gl.STATIC_DRAW);
    buffers.set(p, { vbo, ibo });
  }
  function uploadParts() {
    for (const p of [parts.body, parts.strip]) {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffers.get(p)!.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, p.verts, gl.DYNAMIC_DRAW);
    }
  }

  // ── State ──
  let tear: Tear = emptyTear();
  let seam: Float32Array = new Float32Array(96).fill(TEAR.seamV);
  const s = {
    rx: spring(0, 120, 14),
    ry: spring(0, 120, 14),
    lu: spring(0.25, 90, 16),
    lv: spring(0.2, 90, 16),
    lon: spring(0.35, 60, 14),
    front: spring(0, 520, 46),
    curl: spring(0, 160, 18),
    lift: spring(0, 120, 18),
    loosen: spring(0, 140, 15),
    tug: spring(0, 180, 20),
    dent: spring(0, 260, 24),
  };
  const all: Spring[] = Object.values(s);
  let dentAt = { u: 0.5, v: 0.5 };
  let flight: Flight | null = null;
  let stripGone = false;
  let drop: { t0: number; resolve: () => void } | null = null;
  let dropK = 0;
  let alpha = 1;
  let ready = false;
  let size = { packPx: 280, w: 560, h: 600 };
  let viewProj: Mat4 = camera(560, 600, 280, CAMERA_DIST);
  let bendKey = "";
  const reduced = opts.reducedMotion;

  // ── The loop ──
  let raf = 0;
  let last = 0;
  const frameMs: number[] = [];
  function wake() {
    if (!raf && !disposed && !document.hidden) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function onVisibility() {
    if (document.hidden && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    } else wake();
  }
  document.addEventListener("visibilitychange", onVisibility);

  function frame(now: number) {
    raf = 0;
    const dt = Math.min(1 / 30, Math.max(0.001, (now - last) / 1000));
    if (frameMs.length >= 40) frameMs.shift();
    frameMs.push(now - last);
    last = now;
    let moving = false;
    for (const sp of all) moving = step(sp, dt) || moving;
    if (flight) {
      moving = true;
      flight.t += dt;
      flight.vel[1] -= 6.5 * dt;
      for (let i = 0; i < 3; i++) {
        flight.pos[i] += flight.vel[i] * dt;
        flight.rot[i] += flight.spin[i] * dt;
      }
      if (flight.t > 0.9) {
        flight = null;
        stripGone = true;
      }
    }
    if (drop) {
      moving = true;
      const k = Math.min(1, (now - drop.t0) / 520);
      dropK = k * k * (3 - 2 * k);
      alpha = 1 - dropK;
      if (k >= 1) {
        const r = drop.resolve;
        drop = null;
        r();
      }
    }
    draw();
    adapt();
    if (moving) wake();
  }

  /** Lower the resolution if frames are running long (a modest GPU). */
  function adapt() {
    if (frameMs.length < 40 || dpr <= 1) return;
    const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length;
    if (avg > 24) {
      dprCap = Math.max(1, dpr - 0.25);
      dpr = dprCap;
      frameMs.length = 0;
      resize(size.packPx, size.w, size.h);
    }
  }

  function bend(): Bend {
    return {
      side: tear.side,
      front: Math.min(1, Math.max(0, s.front.x)),
      curl: Math.max(0, s.curl.x),
      lift: s.lift.x,
      seam,
      loosen: Math.max(0, s.loosen.x),
      dent: { u: dentAt.u, v: dentAt.v, depth: Math.max(0, s.dent.x) },
    };
  }

  function draw() {
    if (!ready) return;
    const b = bend();
    const key = `${b.side}|${b.front.toFixed(4)}|${b.curl.toFixed(4)}|${b.lift.toFixed(3)}|${b.loosen.toFixed(4)}|${b.dent.depth.toFixed(4)}|${dentAt.u.toFixed(3)}|${dentAt.v.toFixed(3)}|${seamVersion}`;
    if (key !== bendKey) {
      bendKey = key;
      bendParts(parts, b);
      uploadParts();
    }
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const model = chain(translation(0, -dropK * 0.85 - s.tug.x * 0.03, dropK * -0.1), rotationX(s.rx.x * DEG + dropK * 0.45), rotationY(s.ry.x * DEG));
    gl.uniformMatrix4fv(U.viewProj, false, viewProj);
    gl.uniform3f(U.eye, 0, 0, CAMERA_DIST);
    const lx = s.lu.x - 0.5;
    const ly = (0.5 - s.lv.x) * PACK_ASPECT;
    gl.uniform4f(U.light, lx, ly, 0.75, Math.max(0, s.lon.x));
    gl.uniform2f(U.seamRange, SEAM_MIN, SEAM_SPAN);
    gl.uniform1f(U.bump, 0.85);
    gl.uniform1f(U.aspect, PACK_ASPECT);
    gl.uniform1f(U.exposure, 1.05);
    gl.uniform3f(U.room, 0.3, 0.2, 0.46);

    const front = Math.min(1, Math.max(0, s.front.x));
    const uFront = tear.side === "right" ? 1 - front : front;
    const tornRange: [number, number] = flight || stripGone ? [0, 1] : tear.side === "left" ? [0, uFront] : tear.side === "right" ? [uFront, 1] : [2, 3];
    gl.uniform2f(U.torn, tornRange[0], tornRange[1]);

    drawPart(parts.body, model, 0, alpha);
    if (!stripGone) {
      let m = model;
      let a = alpha;
      if (flight) {
        const f = flight;
        m = chain(model, translation(f.pos[0] + f.pivot[0], f.pos[1] + f.pivot[1], f.pos[2] + f.pivot[2]), rotationZ(f.rot[2]), rotationY(f.rot[1]), rotationX(f.rot[0]), translation(-f.pivot[0], -f.pivot[1], -f.pivot[2]));
        a = alpha * (1 - Math.min(1, Math.max(0, (f.t - 0.16) / 0.5)));
      }
      drawPart(parts.strip, m, 1, a);
    }
  }

  function drawPart(p: Part, model: Mat4, which: number, a: number) {
    if (a <= 0.002) return;
    const { vbo, ibo } = buffers.get(p)!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    const F = 4;
    gl.enableVertexAttribArray(A.pos);
    gl.vertexAttribPointer(A.pos, 3, gl.FLOAT, false, STRIDE * F, 0);
    gl.enableVertexAttribArray(A.nrm);
    gl.vertexAttribPointer(A.nrm, 3, gl.FLOAT, false, STRIDE * F, 3 * F);
    gl.enableVertexAttribArray(A.tan);
    gl.vertexAttribPointer(A.tan, 3, gl.FLOAT, false, STRIDE * F, 6 * F);
    gl.enableVertexAttribArray(A.uv);
    gl.vertexAttribPointer(A.uv, 2, gl.FLOAT, false, STRIDE * F, 9 * F);
    gl.uniformMatrix4fv(U.model, false, model);
    gl.uniformMatrix3fv(U.normalMat, false, normalMatrix(model));
    gl.uniform1f(U.part, which);
    gl.uniform1f(U.alpha, a);
    gl.drawElements(gl.TRIANGLES, p.index.length, gl.UNSIGNED_SHORT, 0);
  }

  function resize(packPx: number, w: number, h: number) {
    size = { packPx, w, h };
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    viewProj = camera(w, h, packPx, CAMERA_DIST);
    void uploadArt(packPx);
    wake();
  }

  let seamVersion = 0;
  uploadSeam(seam);

  const onLost = (e: Event) => {
    e.preventDefault();
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    disposed = true;
    opts.onLost?.();
  };
  canvas.addEventListener("webglcontextlost", onLost);

  const renderer: PackRenderer = {
    kind: "gl",
    resize,
    setTilt(rx, ry) {
      if (reduced) return;
      s.rx.target = rx;
      s.ry.target = ry;
      wake();
    },
    setLight(u, v, on) {
      s.lu.target = u;
      s.lv.target = v;
      s.lon.target = on;
      if (reduced) {
        snap(s.lu, u);
        snap(s.lv, v);
        snap(s.lon, on);
      }
      wake();
    },
    setDent(u, v, depth) {
      if (depth > 0) dentAt = { u, v };
      s.dent.target = reduced ? 0 : depth;
      wake();
    },
    setTear(t, line) {
      tear = t;
      seam = line;
      seamVersion++;
      uploadSeam(line);
      s.front.target = t.progress;
      s.curl.target = t.side === null ? 0 : t.dragging ? 1 : t.progress >= 1 ? 1 : 0.16;
      s.lift.target = t.dragging ? t.lift : 0;
      if (reduced) {
        snap(s.front, t.progress);
        snap(s.curl, s.curl.target);
      }
      wake();
    },
    detach(vx, vy) {
      if (flight || stripGone) return;
      snap(s.front, 1);
      tear = { ...tear, progress: 1, side: tear.side ?? "left" };
      if (reduced) {
        stripGone = true;
        wake();
        return;
      }
      // Pivot about the strip's middle as it is bent right now.
      bendParts(parts, bend());
      let cx = 0;
      let cy = 0;
      let cz = 0;
      const n = parts.strip.verts.length / STRIDE;
      for (let i = 0; i < n; i++) {
        cx += parts.strip.verts[i * STRIDE];
        cy += parts.strip.verts[i * STRIDE + 1];
        cz += parts.strip.verts[i * STRIDE + 2];
      }
      const dir = tear.side === "right" ? -1 : 1;
      const speed = Math.min(6, Math.hypot(vx, vy));
      flight = {
        t: 0,
        pivot: [cx / n, cy / n, cz / n],
        pos: [0, 0, 0],
        vel: [Math.max(-4, Math.min(4, vx)) * 0.35 + dir * 0.9, 0.75 + Math.min(1.5, Math.max(0, vy)) * 0.25, 0.6],
        rot: [0, 0, 0],
        spin: [1.6, dir * (2.2 + speed * 0.3), -dir * (1.8 + speed * 0.35)],
      };
      s.curl.target = 1.25;
      wake();
    },
    loosen(on) {
      s.loosen.target = on ? 1 : 0;
      if (reduced) snap(s.loosen, s.loosen.target);
      wake();
    },
    tug(amount) {
      s.tug.target = reduced ? 0 : amount;
      wake();
    },
    dropAway() {
      if (reduced) {
        alpha = 0;
        dropK = 1;
        wake();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        drop = { t0: performance.now(), resolve };
        wake();
      });
    },
    reset() {
      flight = null;
      stripGone = false;
      drop = null;
      dropK = 0;
      alpha = 1;
      tear = emptyTear();
      seam = new Float32Array(96).fill(TEAR.seamV);
      seamVersion++;
      uploadSeam(seam);
      for (const sp of [s.front, s.curl, s.lift, s.loosen, s.tug, s.dent]) snap(sp, 0);
      wake();
    },
    destroy() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("webglcontextlost", onLost);
      for (const { vbo, ibo } of buffers.values()) {
        gl.deleteBuffer(vbo);
        gl.deleteBuffer(ibo);
      }
      for (const t of Object.values(tex)) gl.deleteTexture(t);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
  return renderer;
}

/** Where a pack-space point lands on the canvas at rest (CSS px from the canvas's top-left). Exported for tests and the DOM layers. */
export function restPoint(u: number, v: number, packPx: number, w: number, h: number): { x: number; y: number } {
  const p = apply(camera(w, h, packPx, CAMERA_DIST), u - 0.5, (0.5 - v) * PACK_ASPECT, 0);
  return { x: ((p[0] / p[3]) * 0.5 + 0.5) * w, y: (1 - ((p[1] / p[3]) * 0.5 + 0.5)) * h };
}
