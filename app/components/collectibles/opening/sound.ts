"use client";

/**
 * Pack-opening sounds, synthesised with WebAudio: no files to download, nothing
 * to license. OFF by default (a classroom is not the place for surprise noise);
 * one toggle, remembered on this device.
 *
 * Every cue is driven by the caller at the moment the matching gesture or
 * animation step happens, and plays synchronously from that call: nothing here
 * schedules on its own clock. Nothing is long-lived: a few shared noise buffers
 * are generated once, every cue is built from short one-shot nodes that are
 * disconnected when they end, and the whole bus is a gentle limiter set well
 * below full scale (peaks around -14 dBFS).
 */

import type { Rarity } from "@/app/lib/collectibles/catalogue/types";

const KEY = "hp:collectibles:sound";

export function readSoundPref(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function writeSoundPref(on: boolean): void {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Private mode or blocked storage: the toggle still works for this visit.
  }
}

export interface PackSounds {
  crinkle(intensity: number): void;
  tearStart(): void;
  tear(advance: number, speed: number): void;
  tearEnd(completed: boolean): void;
  loosen(): void;
  extract(): void;
  deal(index: number): void;
  flip(): void;
  reveal(rarity: Rarity): void;
  complete(): void;
  stopAll(): void;
}

// ---------------------------------------------------------------------------
// Engine

let enabled = false;
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let voiceBus: GainNode | null = null;
let noises: AudioBuffer[] = [];
const live = new Set<AudioScheduledSourceNode>();

const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (x: number) => (x > 0 ? (x < 1 ? x : 1) : 0);

function createContext(): AudioContext | null {
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) return null;
    return new Ctor();
  } catch {
    return null;
  }
}

function freshVoiceBus(a: AudioContext): void {
  voiceBus = a.createGain();
  voiceBus.connect(master!);
}

function ensureGraph(): AudioContext | null {
  if (ctx) return ctx;
  const a = createContext();
  if (!a) return null;
  try {
    ctx = a;
    master = a.createGain();
    master.gain.value = 0.8;
    const comp = a.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 12;
    comp.ratio.value = 8;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    // Soft ceiling at about -11 dBFS: the compressor is slow against a lone sharp grain.
    const clip = a.createWaveShaper();
    const curve = new Float32Array(1025);
    for (let i = 0; i < curve.length; i++) curve[i] = 0.28 * Math.tanh(((i / 512 - 1) * 1) / 0.28);
    clip.curve = curve;
    master.connect(comp).connect(clip).connect(a.destination);
    freshVoiceBus(a);
    // Three 1 s noise buffers, shared by every cue.
    noises = [0, 1, 2].map(() => {
      const buf = a.createBuffer(1, a.sampleRate, a.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    });
    return a;
  } catch {
    ctx = null;
    return null;
  }
}

/** The context, only when sound is on and unlocked and running. */
function ready(): AudioContext | null {
  if (!enabled || !ctx || !voiceBus) return null;
  return ctx;
}

function track(src: AudioScheduledSourceNode, ...nodes: AudioNode[]): void {
  live.add(src);
  src.onended = () => {
    live.delete(src);
    try {
      src.disconnect();
      nodes.forEach((n) => n.disconnect());
    } catch {
      /* already gone */
    }
  };
}

/** A shaped burst of band-passed noise. `to` lets the filter sweep. */
function noise(
  a: AudioContext,
  t: number,
  dur: number,
  gain: number,
  freq: number,
  q = 1,
  opts: { type?: BiquadFilterType; to?: number; attack?: number } = {},
): void {
  const src = a.createBufferSource();
  src.buffer = noises[(Math.random() * noises.length) | 0];
  const f = a.createBiquadFilter();
  f.type = opts.type ?? "bandpass";
  f.frequency.setValueAtTime(freq, t);
  if (opts.to) f.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
  f.Q.value = q;
  const g = a.createGain();
  const at = Math.min(opts.attack ?? 0.002, dur / 2);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + at);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(voiceBus!);
  track(src, f, g);
  src.start(t, Math.random() * 0.8, dur + 0.02);
  src.stop(t + dur + 0.02);
}

/** A pitched blip with an optional glide. */
function tone(
  a: AudioContext,
  t: number,
  freq: number,
  dur: number,
  gain: number,
  type: OscillatorType = "sine",
  glideTo?: number,
  attack = 0.008,
): void {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur);
  const g = a.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(gain, t + Math.min(attack, dur / 2));
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(voiceBus!);
  track(o, g);
  o.start(t);
  o.stop(t + dur + 0.02);
}

/** One sharp foil micro-click: a very short bright noise grain. */
function grain(a: AudioContext, t: number, gain: number, bright: number): void {
  const f = rnd(0.8, 1.25) * (2200 + 5500 * bright);
  noise(a, t, rnd(0.004, 0.012), gain, f, rnd(1.5, 4), { attack: 0.0008 });
}

// ---------------------------------------------------------------------------
// Public switches

export function setSoundEnabled(on: boolean): void {
  enabled = on;
  if (!on) packSounds().stopAll();
}

export function unlockSound(): void {
  if (!enabled) return;
  try {
    const a = ensureGraph();
    if (a && a.state === "suspended") a.resume().catch(() => {});
  } catch {
    /* no audio on this device */
  }
}

// ---------------------------------------------------------------------------
// Cues

let lastCrinkle = 0;
let lastTearT = 0;
let grainDebt = 0;

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

const NOTE = {
  C6: 1046.5, E6: 1318.5, G6: 1568, A6: 1760, C7: 2093, G5: 784, E5: 659.3, C5: 523.3, D6: 1174.7,
};

function guard(fn: (a: AudioContext, t: number) => void): void {
  try {
    const a = ready();
    if (!a) return;
    fn(a, a.currentTime);
  } catch {
    /* a sound must never break the opening */
  }
}

const cues: PackSounds = {
  crinkle(intensity) {
    guard((a, t) => {
      const ms = now();
      if (ms - lastCrinkle < rnd(70, 110)) return;
      lastCrinkle = ms;
      const k = clamp01(intensity);
      const n = 2 + Math.round(k * 3);
      for (let i = 0; i < n; i++) grain(a, t + i * rnd(0.004, 0.012), (0.05 + 0.1 * k) * rnd(0.6, 1), 0.3 + 0.5 * k);
      noise(a, t, 0.05, 0.015 + 0.03 * k, rnd(3000, 5000), 0.7);
    });
  },

  tearStart() {
    guard((a, t) => {
      for (let i = 0; i < 3; i++) grain(a, t + i * rnd(0.008, 0.02), rnd(0.06, 0.1), 0.4);
      tone(a, t, 180, 0.04, 0.03, "triangle", 120);
      lastTearT = 0;
      grainDebt = 0;
    });
  },

  tear(advance, speed) {
    if (!(advance > 0)) return;
    guard((a, t) => {
      const ms = now();
      const dt = lastTearT ? Math.min(0.05, (ms - lastTearT) / 1000) : 1 / 60;
      lastTearT = ms;
      const s = clamp01(speed / 6);
      // Grain density follows speed: a few separate crackles when slow, a dense rip when fast.
      grainDebt += (6 + 230 * s * s + 40 * s) * dt;
      const n = Math.min(6, Math.floor(grainDebt));
      grainDebt -= n;
      for (let i = 0; i < n; i++) {
        grain(a, t + (i / Math.max(1, n)) * dt, (0.05 + 0.11 * s) * rnd(0.55, 1), 0.15 + 0.85 * s);
      }
      // Fast tears add a band-passed body so the crackles fuse into one rip.
      if (s > 0.3) {
        noise(a, t, dt * 1.6, 0.05 * s, 2200 + 3800 * s, 0.9, { attack: 0.006 });
      }
    });
  },

  tearEnd(completed) {
    lastTearT = 0;
    grainDebt = 0;
    if (!completed) return;
    guard((a, t) => {
      for (let i = 0; i < 4; i++) grain(a, t + i * 0.006, rnd(0.1, 0.16), 0.9);
      noise(a, t, 0.16, 0.12, 5500, 0.8, { to: 1800, attack: 0.002 });
      noise(a, t + 0.02, 0.28, 0.04, 3000, 1.2, { to: 1200 });
      tone(a, t, 220, 0.07, 0.05, "triangle", 90);
    });
  },

  loosen() {
    guard((a, t) => {
      noise(a, t, 0.3, 0.05, 900, 0.9, { to: 600, attack: 0.04 });
      for (let i = 0; i < 6; i++) grain(a, t + i * rnd(0.03, 0.06), rnd(0.02, 0.05), 0.1);
    });
  },

  extract() {
    guard((a, t) => {
      // Card stock sliding against foil: a soft band-passed swish with a low rub underneath.
      noise(a, t, 0.62, 0.11, 1100, 0.8, { to: 2600, attack: 0.12 });
      noise(a, t, 0.6, 0.06, 300, 0.7, { attack: 0.1 });
      for (let i = 0; i < 10; i++) grain(a, t + rnd(0.02, 0.55), rnd(0.02, 0.05), 0.2);
      tone(a, t + 0.5, 150, 0.1, 0.04, "sine", 100);
    });
  },

  deal(index) {
    guard((a, t) => {
      const i = Math.max(0, Math.min(2, index | 0));
      const p = 1 + 0.07 * i + rnd(-0.03, 0.03);
      noise(a, t, 0.05, 0.16, 1900 * p, 0.9, { to: 900 * p });
      noise(a, t, 0.1, 0.05, 5000, 0.6, { attack: 0.01 });
      tone(a, t, 150 * p, 0.07, 0.1, "sine", 85 * p);
    });
  },

  flip() {
    guard((a, t) => {
      const p = rnd(0.94, 1.06);
      noise(a, t, 0.022, 0.2, 3400 * p, 1.4, { attack: 0.0008 });
      noise(a, t + 0.012, 0.09, 0.07, 4200, 0.7, { to: 1800, attack: 0.01 });
      tone(a, t, 260 * p, 0.04, 0.05, "triangle", 160);
    });
  },

  reveal(rarity) {
    guard((a, t) => {
      switch (rarity) {
        case "common":
          noise(a, t, 0.012, 0.03, 4000, 2, { attack: 0.0008 });
          break;
        case "uncommon":
          tone(a, t, NOTE.E6, 0.18, 0.04, "sine");
          tone(a, t + 0.06, NOTE.A6, 0.2, 0.03, "sine");
          break;
        case "rare":
          [NOTE.G5, NOTE.C6, NOTE.E6].forEach((f, i) => tone(a, t + i * 0.07, f, 0.5, 0.05, "sine"));
          noise(a, t, 0.5, 0.025, 7000, 1.5, { type: "highpass", attack: 0.05 });
          break;
        case "epic":
          tone(a, t, NOTE.C5, 0.7, 0.045, "triangle", NOTE.C6);
          [NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6].forEach((f, i) => tone(a, t + 0.08 + i * 0.07, f, 0.55, 0.04, "sine"));
          noise(a, t, 0.7, 0.04, 6000, 1.2, { type: "highpass", to: 9000, attack: 0.1 });
          break;
        case "legendary": {
          // A gentle rising pentatonic arpeggio over a warm pad, with glints. Under 1.5 s.
          [NOTE.C5, NOTE.G5, NOTE.C6, NOTE.E6, NOTE.G6, NOTE.C7].forEach((f, i) =>
            tone(a, t + i * 0.09, f, 0.9 - i * 0.04, 0.045, "sine", undefined, 0.012),
          );
          tone(a, t, NOTE.C5 / 2, 1.3, 0.05, "triangle", undefined, 0.15);
          tone(a, t + 0.2, NOTE.G5 * 1.004, 1.1, 0.025, "triangle", undefined, 0.2);
          noise(a, t, 1.3, 0.04, 6500, 1.2, { type: "highpass", to: 10000, attack: 0.25 });
          for (let i = 0; i < 6; i++) tone(a, t + 0.3 + i * 0.1, rnd(3000, 5200), 0.1, 0.014, "sine");
          break;
        }
      }
    });
  },

  complete() {
    guard((a, t) => {
      tone(a, t, NOTE.G5, 0.5, 0.045, "sine");
      tone(a, t + 0.12, NOTE.D6, 0.7, 0.04, "sine");
      tone(a, t + 0.12, NOTE.G5 / 2, 0.7, 0.03, "triangle");
    });
  },

  stopAll() {
    lastTearT = 0;
    grainDebt = 0;
    try {
      const a = ctx;
      if (!a || !voiceBus) return;
      const old = voiceBus;
      const t = a.currentTime;
      old.gain.cancelScheduledValues(t);
      old.gain.setValueAtTime(old.gain.value, t);
      old.gain.linearRampToValueAtTime(0, t + 0.02);
      live.forEach((s) => {
        try {
          s.stop(t + 0.03);
        } catch {
          /* not started or already stopped */
        }
      });
      freshVoiceBus(a);
    } catch {
      /* nothing playing */
    }
  },
};

export function packSounds(): PackSounds {
  return cues;
}
