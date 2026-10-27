// LAST BELL — The Halloween Shift: extra procedural sounds (no recordings needed).
//
// Registered into the game's AudioSystem (audio.registerSound) on the first Halloween run and rendered
// lazily on first use. Everything is kept quiet on purpose: the limiter and these gains keep every cue at
// or below a door slam. Positional cues use the normal panner (HRTF on 'high' quality).
//
//   hw_knock      2-3 muffled knocks on a classroom door          hw_step     a slow bare footstep on lino
//   hw_scrape     a chair dragged a little way                     hw_thud     something small falling over
//   hw_breaker    the distant clunk of the mains tripping          hw_hum_die  fluorescent hum winding down
//   hw_whisper    unintelligible breathy whispering                hw_exhale   a long slow breath, very close
//   hw_drone      low dread bed (loop)                             hw_tap      a fingernail tapping on glass
//   hw_drip       a thick drop landing in a pool (ceiling drips, blood.js)
//   hw_headfall   something heavy and wet hitting lino from a height  hw_ceiling  a ceiling tile shifted aside
// The startle kit (only after the director has made it silent first; see director.sting()):
//   hw_sting      rough dissonant hit (non-positional)          hw_scream   a formant scream, 60-90 Hz rough
//   hw_bang       a locker door slammed                         hw_breath   slow breathing right at the ear
//   hw_nails      fingernails down a metal door                 hw_swell    a rising low swell (looming)
//   hw_static     bodycam signal loss                           hw_heart    a slow heartbeat

import { DSP } from '../audio.js';

const D = DSP;

function knocks() {
  return [0, 1, 2].map((v) => {
    const out = D.arr(1.3);
    const n = v === 2 ? 2 : 3;
    let t = 0.02;
    for (let k = 0; k < n; k++) {
      const exc = D.noise(0.004);
      D.add(out, D.resonate(exc, D.rand(170, 200), 0.18, 1, 0.3), t, 0.9);
      D.add(out, D.resonate(exc, D.rand(390, 460), 0.08, 1, 0.2), t, 0.45);
      D.thump(out, t, 0.6, 120, 70, 0.03, 0.2);
      t += v === 1 ? D.rand(0.32, 0.4) : D.rand(0.22, 0.27);
    }
    D.bq(out, 'lp', 1400, 0.7);
    return D.norm(out, 0.75);
  });
}

function step() {
  return [0, 1, 2].map(() => {
    const out = D.arr(0.45);
    D.thump(out, 0, 0.9, D.rand(70, 85), 45, 0.05, 0.3);
    D.burst(out, 0.004, 0.35, 0.06, 0.002, 0.02, 'bp', D.rand(700, 950), 0.9);
    // a soft sticky peel as the bare foot lifts
    D.burst(out, D.rand(0.16, 0.22), 0.12, 0.05, 0.004, 0.015, 'bp', 2400, 1.2);
    D.bq(out, 'lp', 2200, 0.7);
    return D.norm(out, 0.7);
  });
}

function scrape() {
  return [0, 1].map(() => {
    const dur = D.rand(0.55, 0.85);
    const x = D.noise(dur, 'white');
    D.bq(x, 'bp', D.rand(500, 650), 3, D.rand(900, 1200));
    D.envShape(x, (u) => Math.sin(Math.PI * u) ** 0.6 * (0.55 + 0.45 * Math.abs(Math.sin(u * D.rand(40, 70)))));
    const out = D.arr(dur + 0.2);
    D.add(out, x, 0, 1);
    D.thump(out, dur, 0.4, 110, 80, 0.03, 0.15);
    return D.norm(out, 0.65);
  });
}

function thud() {
  return [0, 1].map(() => {
    const out = D.arr(1.0);
    D.thump(out, 0, 1, 95, 48, 0.07, 0.4);
    D.burst(out, 0, 0.5, 0.08, 0.001, 0.03, 'bp', 600, 0.7);
    let t = D.rand(0.12, 0.2);
    for (let k = 0; k < 3; k++) {
      D.click(out, t, D.rand(0.15, 0.35), D.rand(1500, 3200), 0.01, 'bp');
      t += D.rand(0.07, 0.16);
    }
    D.bq(out, 'lp', 3000, 0.7);
    return D.norm(out, 0.7);
  });
}

function breaker() {
  return [0].map(() => {
    const out = D.arr(1.6);
    D.thump(out, 0, 1, 70, 40, 0.09, 0.5);
    D.click(out, 0, 0.7, 2500, 0.004, 'bp');
    const zap = D.noise(0.3);
    D.bq(zap, 'hp', 1800);
    D.envShape(zap, (u, t) => Math.exp(-t / 0.08) * (0.6 + 0.4 * Math.sin(t * Math.PI * 2 * 100)));
    D.add(out, zap, 0.01, 0.5);
    const tail = D.tone(1.4, 100, 60, 'saw', 0);
    D.bq(tail, 'lp', 400);
    D.envShape(tail, (u) => 0.25 * Math.exp(-u * 4));
    D.add(out, tail, 0.02, 1);
    D.bq(out, 'lp', 2600, 0.7); // heard from a distance
    return D.norm(out, 0.6);
  });
}

function humDie() {
  return [0].map(() => {
    const dur = 2.6;
    const a = D.tone(dur, 100, 62, 'saw');
    const b = D.tone(dur, 200, 125, 'sine');
    const out = D.arr(dur + 0.1);
    D.add(out, a, 0, 0.5);
    D.add(out, b, 0, 0.35);
    D.bq(out, 'lp', 900, 0.8, 300);
    D.envShape(out, (u) => (u < 0.05 ? u / 0.05 : 1) * Math.max(0, 1 - u) ** 1.5 * (0.7 + 0.3 * Math.sin(u * 37)));
    for (let k = 0; k < 6; k++) D.click(out, D.rand(0.3, 2.2), D.rand(0.05, 0.2), 4000, 0.003, 'hp');
    return D.norm(out, 0.5);
  });
}

function whisper() {
  return [0, 1, 2].map(() => {
    const dur = D.rand(1.6, 2.4);
    const out = D.arr(dur);
    let t = 0.05;
    while (t < dur - 0.25) {
      const syl = D.rand(0.09, 0.22);
      const x = D.noise(syl, 'pink');
      const f = D.pick([900, 1300, 1800, 2400, 3100]);
      D.bq(x, 'bp', f, 2.5, f * D.rand(0.8, 1.25));
      D.envShape(x, (u) => Math.sin(Math.PI * u) ** 1.5);
      D.add(out, x, t, D.rand(0.5, 1));
      if (D.rand() < 0.25) {
        const s = D.noise(0.08);
        D.bq(s, 'hp', 4500);
        D.envShape(s, (u) => Math.sin(Math.PI * u));
        D.add(out, s, t + syl * 0.6, 0.5); // a hissed "s"
      }
      t += syl + D.rand(0.02, 0.12);
    }
    D.bq(out, 'hp', 500);
    return D.norm(out, 0.55);
  });
}

function exhale() {
  return [0, 1].map(() => {
    const dur = D.rand(1.5, 2.1);
    const x = D.noise(dur, 'pink');
    D.bq(x, 'bp', 650, 0.8, 420);
    D.envShape(x, (u) => (u < 0.25 ? u / 0.25 : 1) * (1 - u) ** 1.2);
    return D.norm(x, 0.5);
  });
}

function drone() {
  const dur = 8;
  const out = D.arr(dur);
  D.add(out, D.tone(dur, 46, 46, 'sine'), 0, 0.5);
  D.add(out, D.tone(dur, 48.7, 48.7, 'sine'), 0, 0.45);
  D.add(out, D.tone(dur, 92.5, 92.5, 'tri'), 0, 0.12);
  const n = D.noise(dur, 'brown');
  D.bq(n, 'lp', 180);
  D.add(out, n, 0, 0.35);
  D.envShape(out, (u, t) => 0.8 + 0.2 * Math.sin(t * 0.785)); // whole cycles in 8 s, so it loops cleanly
  return [D.loopify(D.norm(out, 0.6), 0.5)];
}

function tap() {
  return [0, 1].map(() => {
    const out = D.arr(1.2);
    let t = 0.02;
    const n = 3 + ((D.rand() * 3) | 0);
    for (let k = 0; k < n; k++) {
      const exc = D.noise(0.002);
      D.add(out, D.resonate(exc, D.rand(2400, 2900), 0.05, 1, 0.08), t, 0.7);
      D.add(out, D.resonate(exc, D.rand(5200, 6100), 0.03, 1, 0.05), t, 0.3);
      t += D.rand(0.16, 0.26);
    }
    return D.norm(out, 0.5);
  });
}

/** A thick drop landing in a pool: a dull pat with a small wet click, nothing like a water "plink". */
function drip() {
  return [0, 1, 2].map(() => {
    const out = D.arr(0.35);
    D.thump(out, 0, 0.7, D.rand(260, 320), 140, 0.012, 0.12);
    const exc = D.noise(0.003);
    D.add(out, D.resonate(exc, D.rand(900, 1300), 0.03, 1, 0.08), 0.002, 0.35);
    D.bq(out, 'lp', 2400, 0.7);
    return D.norm(out, 0.5);
  });
}

/** Heavy, dull and wet: a low body thump, a slap of liquid, a smaller second knock as it bounces. */
function headfall() {
  return [0, 1].map(() => {
    const out = D.arr(1.4);
    D.thump(out, 0, 1, D.rand(78, 92), 42, 0.05, 0.32);
    D.burst(out, 0, 0.9, 0.12, 0.001, 0.05, 'bp', D.rand(520, 700), 0.8); // the slap
    const wet = D.noise(0.18);
    D.bq(wet, 'bp', 1600, 1.2, 900);
    D.envShape(wet, (u, t) => Math.exp(-t / 0.05) * (0.6 + 0.4 * Math.sin(t * 380)));
    D.add(out, wet, 0.004, 0.55);
    const t2 = D.rand(0.3, 0.38);
    D.thump(out, t2, 0.35, 110, 70, 0.03, 0.14);
    D.burst(out, t2, 0.25, 0.05, 0.001, 0.02, 'bp', 800, 0.8);
    // a short dull roll
    const roll = D.noise(0.5, 'brown');
    D.bq(roll, 'lp', 260);
    D.envShape(roll, (u) => Math.sin(Math.PI * u) * (1 - u));
    D.add(out, roll, t2 + 0.06, 0.4);
    D.bq(out, 'lp', 3200, 0.7);
    return D.norm(out, 0.85);
  });
}

function ceiling() {
  return [0, 1].map(() => {
    const dur = D.rand(0.5, 0.75);
    const x = D.noise(dur, 'white');
    D.bq(x, 'bp', D.rand(1200, 1600), 2.5, D.rand(700, 900));
    D.envShape(x, (u) => Math.sin(Math.PI * u) ** 0.8 * (0.5 + 0.5 * Math.abs(Math.sin(u * 23))));
    const out = D.arr(dur + 0.4);
    D.add(out, x, 0, 0.6);
    for (let k = 0; k < 4; k++) D.click(out, D.rand(0.05, dur + 0.2), D.rand(0.15, 0.4), D.rand(2500, 5000), 0.006, 'bp'); // grit
    D.thump(out, dur, 0.4, 150, 100, 0.02, 0.1);
    return D.norm(out, 0.6);
  });
}

// ------------------------------------------------------------------------------------------------ startle kit
// What the research says makes a startle land (see docs/halloween/scare-research.md): an attack under 5 ms,
// rough amplitude modulation in the 30-150 Hz band real screams carry (Arnal et al. 2015), nonlinear
// distortion, and energy at 2-4 kHz where small speakers and ears are most sensitive. Peaks stay at the game's
// existing ceiling (the limiter); the hit feels big because the director makes it silent first.

/** Multiply by a rough amplitude modulation: depth 0..1 at f Hz (with a little wobble so it isn't a tone). */
function rough(x, f, depth, wob = 0.08) {
  const SR = D.SR;
  let ph = Math.random();
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    ph += (f * (1 + wob * Math.sin(t * 9.3))) / SR;
    x[i] *= 1 - depth * 0.5 * (1 + Math.sin(2 * Math.PI * ph));
  }
  return x;
}

/** A non-diegetic sting: dissonant saw cluster + a high screech, roughened at ~70 Hz, a thump with harmonics. */
function sting() {
  return [0, 1, 2].map((v) => {
    const dur = 1.7;
    const out = D.arr(dur);
    const f = [233, 262, 311][v];
    // minor seconds and a tritone, each lowpassed so it stays harsh rather than buzzy
    for (const [k, a] of [[1, 0.5], [1.0595, 0.45], [1.4142, 0.35], [2.119, 0.3]]) {
      const s = D.tone(dur, f * k * 1.03, f * k * 0.97, 'saw');
      D.bq(s, 'lp', 2600, 0.7);
      D.add(out, s, 0, a);
    }
    // the screech (a bowed-string scrape, sliding up then sagging)
    const hi = D.tone(dur, D.rand(1700, 2100), D.rand(2300, 2700), 'saw', 0.18);
    D.bq(hi, 'bp', 2600, 1.6);
    D.add(out, hi, 0, 0.55);
    rough(out, D.rand(64, 78), 0.65);
    D.envShape(out, (u, t) => (t < 0.003 ? t / 0.003 : 1) * (0.35 + 0.65 * Math.exp(-t / 0.35)) * Math.min(1, (dur - t) / 0.25));
    // the hit: a broadband crack and a low body you feel on small speakers (harmonics of ~45 Hz)
    D.burst(out, 0, 1.1, 0.12, 0.0008, 0.035, 'bp', 3000, 0.6);
    D.thump(out, 0, 0.9, 95, 42, 0.12, 0.7);
    for (const h of [90, 135, 180]) {
      const s = D.tone(0.8, h, h * 0.92);
      D.envShape(s, (u, t) => Math.exp(-t / 0.18));
      D.add(out, s, 0, 0.18);
    }
    D.softclip(out, 2.6);
    D.bq(out, 'hp', 45);
    return D.norm(out, 0.92);
  });
}

/** A scream from no human throat: a formant-shaped saw that jumps up, wobbles and breaks, roughened at 60-90 Hz. */
function scream() {
  return [0, 1].map(() => {
    const dur = D.rand(1.1, 1.4);
    const SR = D.SR;
    const n = Math.round(dur * SR);
    const src = new Float32Array(n);
    const f0 = D.rand(620, 760), jump = D.rand(1.35, 1.55);
    const fm = D.rand(62, 78);
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const glide = t < 0.08 ? 1 + (jump - 1) * (t / 0.08) : jump * (1 - 0.18 * ((t - 0.08) / dur)); // jump, then sag
      const f = f0 * glide * (1 + 0.035 * Math.sin(t * 2 * Math.PI * 6.5)) + 38 * Math.sin(t * 2 * Math.PI * fm);
      ph += f / SR;
      ph -= Math.floor(ph);
      src[i] = 2 * ph - 1;
    }
    const nz = D.noise(dur, 'white');
    D.add(src, nz, 0, 0.22);
    const a = Float32Array.from(src), b = Float32Array.from(src);
    D.bq(a, 'bp', 950, 6);
    D.bq(b, 'bp', 2300, 8, 3200);
    const out = D.arr(dur);
    D.add(out, a, 0, 1);
    D.add(out, b, 0, 0.8);
    rough(out, D.rand(60, 90), 0.7, 0.15);
    D.envShape(out, (u, t) => (t < 0.008 ? t / 0.008 : 1) * Math.min(1, (dur - t) / 0.2) * (0.85 + 0.15 * Math.sin(t * 31)));
    D.softclip(out, 4);
    D.bq(out, 'hp', 220);
    return D.norm(out, 0.9);
  });
}

/** A metal locker door slammed hard: inharmonic plate modes, a body thump and the rattle settling. */
function bang() {
  return [0, 1].map(() => {
    const out = D.arr(1.3);
    const exc = D.noise(0.012);
    D.envShape(exc, (u) => 1 - u);
    const base = D.rand(165, 205);
    for (const [k, a, t] of [[1, 1, 0.45], [2.76, 0.7, 0.3], [5.4, 0.5, 0.18], [8.93, 0.35, 0.1]]) D.add(out, D.resonate(exc, base * k * D.rand(0.98, 1.02), t, a, 1.2), 0, 1);
    D.thump(out, 0, 1, 110, 55, 0.06, 0.4);
    D.burst(out, 0, 0.8, 0.05, 0.0005, 0.012, 'hp', 2500);
    let t = D.rand(0.09, 0.14);
    for (let k = 0; k < 5; k++) {
      const e = D.noise(0.004);
      D.add(out, D.resonate(e, base * D.rand(2.5, 6), 0.05, 1, 0.1), t, 0.5 * (1 - k / 6));
      t += D.rand(0.03, 0.08);
    }
    D.softclip(out, 1.6);
    return D.norm(out, 0.9);
  });
}

/** Slow breathing right at the ear: a ragged inhale, a held beat, a long wet exhale with a little voice in it. */
function breath() {
  return [0, 1].map(() => {
    const out = D.arr(3.3);
    const inh = D.noise(1.0, 'pink');
    D.bq(inh, 'bp', 1100, 1.1, 1600);
    D.envShape(inh, (u, t) => Math.sin(Math.PI * Math.min(1, u * 1.15)) ** 1.4 * (0.7 + 0.3 * Math.sin(t * 47)));
    D.add(out, inh, 0.05, 0.55);
    const ex = D.noise(1.6, 'pink');
    D.bq(ex, 'bp', 820, 0.9, 520);
    D.envShape(ex, (u) => (u < 0.12 ? u / 0.12 : 1) * (1 - u) ** 1.1);
    D.add(out, ex, 1.45, 1);
    const voice = D.tone(1.4, D.rand(88, 100), 72, 'saw');
    D.bq(voice, 'lp', 520, 0.9);
    rough(voice, 34, 0.6, 0.3); // a rasp, not a tone
    D.envShape(voice, (u) => Math.sin(Math.PI * u) * 0.5);
    D.add(out, voice, 1.5, 0.22);
    D.bq(out, 'hp', 120);
    return D.norm(out, 0.6);
  });
}

/** The boy's own gasp: a tiny voiced catch, a sharp rising inhale, held, then a shaky exhale (a 6-8 Hz tremble). */
function gasp() {
  return [0, 1, 2].map(() => {
    const out = D.arr(1.9);
    const f0 = D.rand(175, 215);
    const v = D.tone(0.09, f0 * 1.15, f0, 'saw');
    D.bq(v, 'bp', 900, 1.2);
    D.envShape(v, (u) => Math.sin(Math.PI * u));
    D.add(out, v, 0, 0.35);
    const inh = D.noise(0.34, 'pink');
    D.bq(inh, 'bp', 1200, 1.6, 2100);
    D.envShape(inh, (u) => (u < 0.18 ? u / 0.18 : 1) * (1 - u) ** 0.6);
    D.add(out, inh, 0.02, 1);
    const ex = D.noise(1.0, 'pink');
    D.bq(ex, 'bp', 700, 0.9, 480);
    const tr = D.rand(6, 8);
    D.envShape(ex, (u, t) => (u < 0.1 ? u / 0.1 : 1) * (1 - u) ** 1.3 * (0.65 + 0.35 * Math.sin(t * tr * Math.PI * 2)));
    D.add(out, ex, 0.75, 0.55);
    D.bq(out, 'hp', 150);
    return D.norm(out, 0.7);
  });
}

/** A wet palm slapped flat on a wall: a sharp crack, the wall's thump, a squelch as it smears, a few drops. */
function slap() {
  return [0, 1, 2].map(() => {
    const out = D.arr(1.2);
    D.burst(out, 0, 1, 0.08, 0.0008, 0.012, 'bp', D.rand(1300, 1800), 0.7);
    D.burst(out, 0.002, 0.6, 0.12, 0.001, 0.03, 'lp', 3500, 0.7);
    D.thump(out, 0, 0.9, D.rand(85, 105), 55, 0.06, 0.4);
    const sq = D.noise(0.35, 'pink');
    D.bq(sq, 'bp', 1600, 3, 500);
    D.envShape(sq, (u) => (u < 0.1 ? u / 0.1 : 1) * (1 - u) ** 2);
    D.add(out, sq, 0.05, 0.45);
    for (let i = 0; i < 3; i++) D.click(out, D.rand(0.25, 0.9), D.rand(0.1, 0.2), D.rand(900, 1600), 0.006);
    return D.norm(out, 0.9);
  });
}

/** A fluorescent tube failing to start: the 100 Hz ballast buzz climbing, crackles getting denser, cut off dead. */
function buzz() {
  return [0, 1].map(() => {
    const dur = 2.4;
    const out = D.arr(dur);
    const hum = D.tone(dur, 100, 100, 'saw');
    D.bq(hum, 'bp', 600, 0.6);
    D.envShape(hum, (u, t) => (0.15 + 0.85 * u * u) * (0.7 + 0.3 * Math.sin(t * 2 * Math.PI * 3.1)));
    D.add(out, hum, 0, 0.5);
    const hiss = D.noise(dur, 'white');
    D.bq(hiss, 'bp', 4200, 0.8);
    D.envShape(hiss, (u) => 0.05 + 0.25 * u * u);
    D.add(out, hiss, 0, 0.3);
    for (let t = 0.05; t < dur - 0.05; t += D.rand(0.03, 0.22) * (1.2 - t / dur)) D.click(out, t, D.rand(0.2, 0.7) * (0.3 + t / dur), D.rand(1800, 5200), 0.002);
    D.envShape(out, (u) => (u > 0.97 ? (1 - u) / 0.03 : 1)); // cut off dead
    return D.norm(out, 0.65);
  });
}

/** Fingernails dragged slowly down a metal door: stick-slip squeal through a few inharmonic plate modes. */
function nails() {
  return [0].map(() => {
    const dur = 2.6;
    const SR = D.SR;
    const n = Math.round(dur * SR);
    const exc = new Float32Array(n);
    let slip = 0;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const rate = 26 + 10 * Math.sin(t * 2.1) + 6 * Math.random();
      slip += rate / SR;
      const ph = slip - Math.floor(slip);
      exc[i] = (ph < 0.08 ? 1 - ph / 0.08 : 0) * (0.6 + 0.4 * Math.random()) + (Math.random() * 2 - 1) * 0.04;
    }
    const out = D.arr(dur);
    const base = 760;
    for (const [k, a] of [[1, 0.5], [2.76, 0.7], [5.4, 0.45], [8.93, 0.25]]) {
      const s = Float32Array.from(exc);
      D.bq(s, 'bp', base * k, 28, base * k * 0.86); // the pitch sags as the hand drags down
      D.add(out, s, 0, a);
    }
    D.envShape(out, (u) => Math.min(1, u * 6) * Math.min(1, (1 - u) * 5) * (0.75 + 0.25 * Math.sin(u * 40)));
    return D.norm(out, 0.6);
  });
}

/** A rising low swell (auditory looming): 41 Hz with beating and the harmonics phone speakers can play. */
function swell() {
  return [0].map(() => {
    const dur = 4.2;
    const out = D.arr(dur);
    for (const [f, a] of [[41, 0.6], [43.5, 0.5], [82, 0.35], [123, 0.25], [164, 0.16], [246, 0.07]]) D.add(out, D.tone(dur, f, f * 1.04), 0, a);
    const nz = D.noise(dur, 'brown');
    D.bq(nz, 'lp', 220);
    D.add(out, nz, 0, 0.4);
    D.envShape(out, (u) => Math.pow(u, 2.2) * (u > 0.97 ? (1 - u) / 0.03 : 1));
    D.softclip(out, 1.4);
    return D.norm(out, 0.7);
  });
}

/** Bodycam signal loss: crackling hiss with dropouts and a mains buzz. */
function staticHiss() {
  return [0].map(() => {
    const dur = 2.2;
    const out = D.noise(dur, 'white');
    D.bq(out, 'bp', 2400, 0.5);
    const buzz = D.tone(dur, 100, 100, 'square');
    D.bq(buzz, 'lp', 1200);
    D.add(out, buzz, 0, 0.12);
    let gate = 1;
    D.envShape(out, (u, t) => {
      if (Math.random() < 0.0009) gate = Math.random() < 0.5 ? 0.15 : 1;
      return gate * Math.min(1, t / 0.004) * Math.min(1, (dur - t) / 0.05);
    });
    for (let k = 0; k < 40; k++) D.click(out, D.rand(0, dur - 0.05), D.rand(0.3, 1), D.rand(1500, 6000), 0.002, 'bp');
    return D.norm(out, 0.55);
  });
}

/** A slow heartbeat (lub-dub), its fundamental carried by harmonics so laptops play it. */
function heartbeat() {
  return [0].map(() => {
    const out = D.arr(1.0);
    for (const [t, a] of [[0, 1], [0.24, 0.7]]) {
      D.thump(out, t, a, 62, 40, 0.06, 0.3);
      const h = D.tone(0.25, 124, 90);
      D.envShape(h, (u, tt) => Math.exp(-tt / 0.05));
      D.add(out, h, t, a * 0.35);
    }
    D.bq(out, 'lp', 400);
    return D.norm(out, 0.7);
  });
}

const DEFS = {
  hw_sting: [{ gain: 0.95, wet: 0.15 }, sting],
  hw_scream: [{ gain: 0.85, wet: 0.2, ref: 1.2, roll: 1.2 }, scream],
  hw_bang: [{ gain: 0.95, wet: 0.45, ref: 2.5, roll: 1.0 }, bang],
  hw_breath: [{ gain: 0.6, wet: 0.04, ref: 0.35, roll: 2.2 }, breath],
  hw_nails: [{ gain: 0.6, wet: 0.2, ref: 0.8, roll: 1.6 }, nails],
  hw_swell: [{ gain: 0.55, wet: 0 }, swell],
  hw_static: [{ gain: 0.5, wet: 0 }, staticHiss],
  hw_heart: [{ gain: 0.55, wet: 0 }, heartbeat],
  hw_gasp: [{ gain: 0.7, wet: 0.02 }, gasp], // the player's own: never placed in 3D
  hw_buzz: [{ gain: 0.6, wet: 0.2, ref: 3 }, buzz],
  hw_slap: [{ gain: 0.95, wet: 0.12, ref: 2 }, slap],
  hw_headfall: [{ gain: 0.85, wet: 0.4, ref: 2.5, roll: 1.0 }, headfall],
  hw_ceiling: [{ gain: 0.5, wet: 0.3, ref: 2, roll: 1.1 }, ceiling],
  hw_drip: [{ gain: 0.38, wet: 0.35, ref: 1, roll: 1.3 }, drip],
  hw_knock: [{ gain: 0.7, wet: 0.35, ref: 2.5, roll: 1.1 }, knocks],
  hw_step: [{ gain: 0.75, wet: 0.35, ref: 2, roll: 1.0 }, step],
  hw_scrape: [{ gain: 0.55, wet: 0.35, ref: 2, roll: 1.1 }, scrape],
  hw_thud: [{ gain: 0.65, wet: 0.4, ref: 2, roll: 1.1 }, thud],
  hw_breaker: [{ gain: 0.6, wet: 0.5, ref: 4, roll: 0.9 }, breaker],
  hw_hum_die: [{ gain: 0.4, wet: 0.3, ref: 3, roll: 1.0 }, humDie],
  hw_whisper: [{ gain: 0.42, wet: 0.25, ref: 1.2, roll: 1.4 }, whisper],
  hw_exhale: [{ gain: 0.32, wet: 0.1, ref: 0.8, roll: 1.6 }, exhale],
  hw_drone: [{ bus: 'amb', gain: 0.35, wet: 0.2 }, drone],
  hw_tap: [{ gain: 0.45, wet: 0.3, ref: 1.5, roll: 1.2 }, tap],
};

export function registerHalloweenSounds(audio) {
  if (!audio?.registerSound) return false;
  for (const [id, [meta, fn]] of Object.entries(DEFS)) audio.registerSound(id, meta, fn);
  return true;
}

export const HW_SOUNDS = Object.keys(DEFS);
