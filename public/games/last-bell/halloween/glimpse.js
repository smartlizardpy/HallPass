// LAST BELL — The Halloween Shift: the flicker reveal (the opening and `light_glimpse` both use it).
//
// Like a theatre: the house lights go down, then a spotlight finds the thing on the stage. Every light in the
// corridor cuts out at once; in the dark, only the light at the far end, where it stands, flickers on, and in the
// flashes the ghost is standing under it; then the lights come back to normal (playtest: a silent quarter-second
// figure, or one close by, reads as a rendering bug; "too close"; "lights turn off for the reveal, like a theatre
// stage, the lights reveal the thing then go normal; the flicker happens at the end of the corridor"):
//   A. lights down         a breaker clunk and every tube in the corridor goes out together; silence; then the
//                          dead tube at the far end buzzes in the dark
//   B. the flicker         only that tube stutters on, three times. The first flash is empty. In the next two it is
//                          standing at the end, a little different each time (still, then its head tilts). It
//                          never comes closer. It exists only while that light is on.
//   C. the hit             a held breath of dark (nothing plays in the last half second: prepulse inhibition), then
//                          the tube catches for half a second: it is twisted, facing you, with the sting and the flinch
//   D. reaction            dark at the end; the boy gasps, the heart goes
//   E. lights up           the corridor comes back on, normal, empty
// Photosensitivity: one small light far away, under 2 flashes a second; reduced effects makes it two slow pulses.
// The flickering tube switches fast (f.snap, world-lights.js: ~25 ms edges instead of ~300 ms) and keeps its slot
// in the real light pool through the dark, so the figure is lit in every flash.

const V = (x, y, z) => ({ x, y, z });
const POSES = { mild: ['stand', 'stand', 'stare'], full: ['stand', 'stare', 'distort'] };
const AMB = 0.22; // the ambient while it plays: the house lights down (your torch still works)
const FOG = 0.45; // and the fog thins (hidden by the dark): at 14-20 m the fog turned the figure into a dark shape

/**
 * d: the director. o.tube (the far fixture), o.group (the far fixtures, they go together), o.path (the corridor
 * tubes between you and it: they go out), o.spot ({x, z} under the far tube, 12-20 m away), o.pose (null: an
 * empty flicker), o.wait(sec) (ctx.wait, or a timer that rejects when cancelled), o.strength (sting volume, 0 = none).
 * Returns 'seen' | 'empty'. On abort the caller restores the lights and hides the Watcher.
 */
export async function glimpse(d, o) {
  const g = d.game, L = d.lights, w = d.watcher;
  const { tube, group, path = [], spot, pose = 'stare', wait, strength = 0.75 } = o;
  const base = L.baseLevel ?? 1;
  const amb0 = L.ambientLevel ?? 1;
  const fog0 = L.env?.fogMul ?? 1;
  const far = group.filter((f) => !path.includes(f));
  const tpos = V(tube.x, 2.7, tube.z);
  const reduced = !!d.reducedFlash;
  const loud = d.intensity !== 'mild';
  const poses = pose ? POSES[loud ? 'full' : 'mild'] : null;
  // only the tube(s) over it switch
  const set = (lvl, fade = 0) => {
    for (const f of far) L.fixture(f.index, lvl, reduced ? Math.max(fade, 0.15) : fade);
  };
  const snap = (on) => {
    for (const f of far) f.snap = on && !reduced ? 2 : 0;
  };
  // the figure: placed on the first flash it is in, then only shown while the light is on
  const show = (k, glow = 0.3) => {
    if (!poses) return false;
    if (!w.active) {
      const e = d.gaze.eye;
      const yaw = Math.atan2(-(e.x - spot.x), -(e.z - spot.z));
      if (!w.appear({ pos: V(spot.x, 0, spot.z) }, { pose: poses[k], force: true, face: true, yaw })) return false;
    } else {
      w.setPose(poses[k], 0);
      w.facePlayer?.();
    }
    w.object.visible = true;
    w.setEmissive?.(glow); // pale in the tube light (the engine's light pool barely reaches this far)
    return true;
  };
  const conceal = () => {
    if (!w.active) return;
    w.setEmissive?.(0);
    w.object.visible = false;
  };
  d._glimpsing = true;
  snap(true);
  try {
    // A. lights down: a clunk, and the whole corridor goes out at once
    d.duck(0.2, 0.4);
    const near = path.length ? path.reduce((a, f) => (Math.hypot(f.x - d.gaze.eye.x, f.z - d.gaze.eye.z) < Math.hypot(a.x - d.gaze.eye.x, a.z - d.gaze.eye.z) ? f : a)) : tube;
    g.audio?.play?.('hw_breaker', { position: V(near.x, 2.6, near.z), volume: 0.8 });
    for (const f of path) {
      if (!reduced) f.snap = 1; // a cut, not a fade
      L.fixture(f.index, 0, reduced ? 0.3 : 0.05);
    }
    set(0, 0.05);
    L.ambient?.(Math.min(amb0, AMB), reduced ? 0.4 : 0.1);
    L.fog?.(Math.min(fog0, FOG), 0.6);
    await wait(0.25);
    for (const f of path) f.snap = 0; // (they leave the light pool once they're out)
    await wait(0.55); // (playtest: "slow"; it was 2.6 s of dark before the first flash, now 1.6)
    g.audio?.play?.('hw_buzz', { position: tpos, volume: 0.9 });
    await wait(0.8);
    // B. the flicker: [time on, time off, pose index or -1 for empty]
    const flashes = reduced ? [[0.55, 0.9, 0], [0.6, 1.0, 1]] : [[0.08, 0.42, -1], [0.11, 0.45, 0], [0.13, 0.5, 1]];
    for (const [on, off, k] of flashes) {
      g.audio?.play?.('flicker', { position: tpos, volume: 0.45 });
      if (k >= 0) show(k, 0.95);
      set(1);
      await wait(on);
      set(0);
      await wait(0.035);
      conceal();
      await wait(off);
    }
    // C. a held breath of dark, then the hit
    d.duck(0.03, 0.12);
    await wait(0.45 + Math.random() * 0.2);
    const shown = show(2, 1.1);
    set(1);
    if (shown && loud && strength > 0) {
      d.lastStingAt = d.time;
      g.audio?.play?.('hw_sting', { volume: strength });
      // the frame with it in freezes for a moment (the bodycam stutters on it); a light tear, so it stays visible
      await wait(0.07);
      d.jolt?.({ glitch: 0.28, hold: 0.14, kick: 5 });
      await wait(reduced ? 0.73 : 0.48);
    } else await wait(reduced ? 0.8 : 0.55);
    set(0);
    await wait(0.04);
    conceal();
    if (w.active) w.vanish('now'); // in the dark: no cover needed
    // D. reaction
    if (shown) {
      await wait(0.2);
      d._lastReact = -99; // always: this is its own reaction
      d.react(0, { gasp: 0.85, heart: 0.75 });
    }
    await wait(0.8 + Math.random() * 0.3);
    // E. lights up: the corridor comes back on, normal, empty
    snap(false);
    set(base, 0.35);
    for (const f of path) L.fixture(f.index, base, 0.7);
    L.ambient?.(amb0, 0.9);
    L.fog?.(fog0, 1.2);
    d.duck(1, 3);
    return shown ? 'seen' : 'empty';
  } finally {
    snap(false);
    for (const f of path) f.snap = 0;
    L.fog?.(fog0, 1.2); // (also when it's cut short)
    d._glimpsing = false;
  }
}

/**
 * The stage: the end of the corridor you are looking down, with the last light before it. The tube `f` is in view;
 * the corridor runs along the grid (x or z) towards it. Walks down the corridor on the tube's line until it stops
 * being corridor you can see (the end wall, a turn, a doorway into a room). The tube must be the last light before
 * that end (within 3 m); the ghost stands at the end, under or just past that light (playtest: "the flicker happens
 * at the end of the corridor, where the thing is standing"). Returns { end, spot } or null.
 */
export function endStage(world, eye, f, { near = 12, far = 24 } = {}) {
  const dx = f.x - eye.x, dz = f.z - eye.z;
  const alongX = Math.abs(dx) >= Math.abs(dz);
  const ax = alongX ? Math.sign(dx) : 0, az = alongX ? 0 : Math.sign(dz);
  const dt = alongX ? Math.abs(dx) : Math.abs(dz); // the tube, down the corridor
  if (Math.abs(alongX ? dz : dx) > 2.5) return null; // not down this corridor
  const sx = alongX ? eye.x : f.x, sz = alongX ? f.z : eye.z; // level with you, on the tube's line
  let end = 0;
  for (let t = 0.6; t <= far + 3; t += 0.4) {
    const x = sx + ax * t, z = sz + az * t;
    if (!world.isWalkable(x, z, 0.25, 0) || !world.getRoomAt(x, z, 0)?.isCorridor || !world.lineOfSight(eye, { x, y: 1.3, z })) break;
    end = t;
  }
  if (end < near || end > far || end - dt > 3 || dt - end > 0.6) return null;
  const at = Math.min(Math.max(end - 0.7, dt - 0.3), dt + 1.6);
  const spot = { x: sx + ax * at, z: sz + az * at };
  if (!world.isWalkable(spot.x, spot.z, 0.25, 0)) return null;
  return { end, spot };
}

/** The ceiling tubes down this corridor, from a little behind you to a little past the far tube (not the far group):
 *  the house lights. Lights behind it would backlight the stage. */
export function corridorPath(d, tube, group) {
  const e = d.gaze.eye, w = d.game.world;
  const dx = tube.x - e.x, dz = tube.z - e.z, len = Math.hypot(dx, dz) || 1;
  const skip = new Set(group.map((f) => f.index));
  return d.lights.lights.fixtures.filter((f) => {
    if (skip.has(f.index) || f.kind === 'glow' || (f.floor || 0) !== 0 || f.state === 'broken') return false;
    if (!w.rooms[f.roomId]?.isCorridor) return false;
    const u = ((f.x - e.x) * dx + (f.z - e.z) * dz) / len;
    const off = Math.abs((f.x - e.x) * dz - (f.z - e.z) * dx) / len;
    return u > -8 && u < len + 6 && off < 3.2;
  });
}
