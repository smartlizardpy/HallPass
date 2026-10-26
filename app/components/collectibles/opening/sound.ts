"use client";

/**
 * Pack-opening sounds, synthesised with WebAudio: no files to download, nothing
 * to license. OFF by default (a classroom is not the place for surprise noise);
 * one toggle, remembered on this device. Quiet, short, never a loop.
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

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(a: AudioContext, freq: number, start: number, length: number, type: OscillatorType = "triangle", gain = 0.08) {
  const osc = a.createOscillator();
  const env = a.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  env.gain.setValueAtTime(0, start);
  env.gain.linearRampToValueAtTime(gain, start + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(env).connect(a.destination);
  osc.start(start);
  osc.stop(start + length + 0.02);
}

/** A short paper rip: filtered noise. */
export function playTear(): void {
  const a = audio();
  if (!a) return;
  const length = 0.22;
  const buffer = a.createBuffer(1, Math.floor(a.sampleRate * length), a.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = a.createBufferSource();
  src.buffer = buffer;
  const filter = a.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = 2400;
  filter.Q.value = 0.8;
  const env = a.createGain();
  env.gain.value = 0.12;
  src.connect(filter).connect(env).connect(a.destination);
  src.start();
}

/** A card flip: one soft click. */
export function playFlip(): void {
  const a = audio();
  if (!a) return;
  tone(a, 660, a.currentTime, 0.06, "square", 0.03);
}

const CHIME: Record<Rarity, number[]> = {
  common: [],
  uncommon: [784],
  rare: [659, 988],
  epic: [523, 784, 1047],
  legendary: [523, 659, 784, 1047],
};

/** A rising chime, one note per rarity step above uncommon. Nothing for a common card. */
export function playChime(rarity: Rarity): void {
  const notes = CHIME[rarity];
  if (!notes.length) return;
  const a = audio();
  if (!a) return;
  notes.forEach((f, i) => tone(a, f, a.currentTime + i * 0.09, 0.35, "triangle", 0.06));
}
