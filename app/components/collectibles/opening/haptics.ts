"use client";

/**
 * Pack-opening haptics. navigator.vibrate exists on Android Chrome and not on
 * iOS Safari, where every call here is a quiet no-op. Pulses are short (never
 * under 3 ms, never more than 60 ms in total per call) and rate-limited so a
 * per-frame caller cannot buzz the phone continuously.
 */

import type { Rarity } from "@/app/lib/collectibles/catalogue/types";

let enabled = true;
let lastAt = 0;

export function setHapticsEnabled(on: boolean): void {
  enabled = on;
}

/** Clamp a pattern: pulses >= 3 ms, total <= 60 ms (gaps count towards the total). */
function buzz(pattern: number[], minGapMs = 0): void {
  if (!enabled) return;
  try {
    if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (minGapMs > 0 && now - lastAt < minGapMs) return;
    const safe: number[] = [];
    let total = 0;
    pattern.forEach((ms, i) => {
      const isPulse = i % 2 === 0;
      let v = Math.max(isPulse ? 3 : 1, Math.round(ms));
      if (total + v > 60) v = 60 - total;
      if (v <= 0 || (isPulse && v < 3)) return;
      safe.push(v);
      total += v;
    });
    if (!safe.length) return;
    lastAt = now;
    navigator.vibrate(safe);
  } catch {
    // Blocked by permissions policy or unsupported: haptics are only a bonus.
  }
}

export const haptics = {
  grab(): void {
    buzz([8]);
  },
  tearTick(): void {
    buzz([5], 40);
  },
  snap(): void {
    buzz([14, 18, 8]);
  },
  deal(): void {
    buzz([10]);
  },
  reveal(rarity: Rarity): void {
    if (rarity === "rare") buzz([16]);
    else if (rarity === "epic") buzz([18, 24, 10]);
    else if (rarity === "legendary") buzz([14, 14, 10, 14, 6]);
  },
};
