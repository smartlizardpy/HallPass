// LAST BELL — audio system (S3). Web Audio API, fully procedural with optional file overrides.
//
//   import { AudioSystem, SOUND_IDS, VOICE_LINES, ANNOUNCEMENTS, SOUND_FILES } from './audio.js';
//   const audio = new AudioSystem(game);   // never creates an AudioContext here
//   audio.unlock();                        // call inside a user gesture (also self-unlocks on the first
//                                          // pointerdown/keydown anywhere on the page)
//   audio.update(dt, game);                // every frame (cheap; no allocations)
//
// Public API (CONTRACTS §11 + extensions):
//   unlock() → Promise<bool>     idempotent; creates/resumes the AudioContext synchronously, builds the graph,
//                                renders the essential procedural buffers, renders the rest in idle slices,
//                                then loads file overrides listed in assets/audio/manifest.json.
//   unlocked                     bool getter
//   setListener(camera)          listener follows this camera (default: game.camera)
//   play(id, { position, volume, rate, surface, speed, line, delay, pan }) → { stop() } | null
//   setMusicState(state)         'none'|'menu'|'calm'|'tension'|'chase'|'victory'|'defeat'
//                                (while game.state === 'playing' update() auto-drives calm/tension/chase from
//                                 game.enemy.state / getThreat(); an explicit call holds until the auto target changes)
//   musicState                   current music state (getter)
//   setVolumes({ master, music, sfx, voice, chat })   0..1, perceptual (squared) taper, smoothed (chat: co-op)
//   setPaused(bool)              extension used by game.js: lowpass + −8 dB duck of music/ambience, pauses TTS
//   announce(id, text)           extension: full PA sequence (chime → static bed → voice file or TTS → un-duck)
//   speak(text, { pitch, rate, volume })   speechSynthesis placeholder voice (settings.voiceSynth !== false)
//   announcing                   extension (co-op voice chat): true while an announcement or a PA broadcast plays
//   chatDuck(on)                 extension (co-op voice chat): while a friend talks, the PA steps back −9 dB and
//                                the music −5 dB, so friends are heard over announcements
//   chatBus                      extension (co-op voice chat): where friends' voices go (settings.chatVolume)
//   update(dt, game), stopAll(), dispose()
//   prerenderAll() / debugInfo() / debugPeaks() / debugLevel()   dev/test helpers
//
// Routing: master → limiter → destination. Buses: music, sfx, voice, ambience (ambience follows the sfx
// volume). Music + ambience + reverb return pass through a "world" lowpass/duck stage (pause). A shared
// ConvolverNode reverb with a generated long tiled-corridor impulse response is fed by per-bus sends. PA
// announcements run through a band-limited light-distortion chain with a short slap echo.
//
// Optional file overrides (e.g. ElevenLabs deliverables, see ELEVENLABS_ASSET_REQUESTS.md):
//   1. drop the mp3 into assets/audio/ using the exact filename from SOUND_FILES below;
//   2. add its id to "available" in assets/audio/manifest.json, e.g. { "available": ["bell", "announcement_intro"] }.
//   Only listed ids are fetched (so a missing optional file never produces a 404 in the console). Any fetch /
//   decode failure silently keeps the procedural version. manifest "files": { id: "assets/audio/x.mp3" } can map
//   extra ids (e.g. music_calm, music_tension) or rename files. "probeAll": true (or ?audioprobe in the page URL)
//   tries every SOUND_FILES entry (404s are then expected).
//
// Events consumed (CONTRACTS §5 + extensions): player:footstep, enemy:footstep, door:open, door:close,
// door:locked, hide:enter, hide:exit, item:collected, player:flashlight {on}, player:stamina-empty,
// player:breath {holding}, enemy:voice, enemy:spotted, announcement, lights:flicker, world:transform-warning,
// world:room000, game:state, settings:change.
// Never auto-plays bell / exit_denied / exit_unlock / escape / capture_sting / transform / victory / defeat
// (game.js calls those via play()).
//
// Settings read: masterVolume, musicVolume, sfxVolume, voiceVolume, chatVolume, quality ('high' → HRTF panning),
// voiceSynth (extension, default true: speechSynthesis placeholder for spoken lines without files).

// ---------------------------------------------------------------------------------------------
// Text tables (ui.js imports VOICE_LINES for caretaker subtitles)
// ---------------------------------------------------------------------------------------------
export const VOICE_LINES = {
  still_here: "I know you're still in here.",
  corridor: 'No running in the corridors.',
  school_closed: "School's closed. Everyone's gone home.",
  found_you: 'There you are.',
  hum: '[low humming]',
  burp: '[burps]',
  // when he runs out of breath mid-chase. The recorded line (caretaker_wheeze.mp3) says these words;
  // without it the game plays a procedural wheeze and ui.js shows "[wheezing]" instead.
  wheeze: 'No… running… in the corridors.',
  // when he pulls you out of a hiding place. Until caretaker_found_hiding.mp3 is installed the recorded
  // "There you are." (caretaker_found_you) stands in, and ui.js subtitles it as that.
  found_hiding: 'There you are… there you are.',
};

// Canonical PA texts. These match the texts game.js emits with its 'announcement' events, so the
// subtitles and the ElevenLabs scripts agree. When an event carries its own text, that text is used.
export const ANNOUNCEMENTS = {
  announcement_intro:
    'Good evening, students. The final bell has now rung. All remaining students are required to report to Room 000. ' +
    'Please remain calm. The doors have been locked for your safety. Thank you for your cooperation.',
  announcement_room000: 'Room 000 is now open. Attendance is mandatory.',
  announcement_shift: 'Corridors are being reassigned. Please stay where you can be found.',
  announcement_late: 'Attention. The building will be secured in sixty seconds. Remain where you are.',
};

// Every id that may be overridden by a file. Exactly the deliverables in ELEVENLABS_ASSET_REQUESTS.md.
export const SOUND_FILES = {
  announcement_intro: 'assets/audio/announcement_intro.mp3',
  announcement_room000: 'assets/audio/announcement_room000.mp3',
  announcement_late: 'assets/audio/announcement_late.mp3',
  announcement_shift: 'assets/audio/announcement_shift.mp3',
  caretaker_still_here: 'assets/audio/caretaker_still_here.mp3',
  caretaker_corridor: 'assets/audio/caretaker_corridor.mp3',
  caretaker_school_closed: 'assets/audio/caretaker_school_closed.mp3',
  caretaker_found_you: 'assets/audio/caretaker_found_you.mp3',
  caretaker_hum: 'assets/audio/caretaker_hum.mp3',
  caretaker_burp: 'assets/audio/caretaker_burp.mp3',
  caretaker_wheeze: 'assets/audio/caretaker_wheeze.mp3',
  caretaker_found_hiding: 'assets/audio/caretaker_found_hiding.mp3',
  fuse_crackle: 'assets/audio/fuse_crackle.mp3',
  // SCHOOLNET broadcasts (optional recordings; see the cast sheet)
  pa_song: 'assets/audio/pa_song.mp3',
  announcement_caretaker: 'assets/audio/announcement_caretaker.mp3',
  bell: 'assets/audio/school_bell.mp3',
  pa_static: 'assets/audio/intercom_static.mp3',
  ambience_corridor: 'assets/audio/ambience_corridor.mp3',
  music_chase: 'assets/audio/music_chase.mp3',
  capture_sting: 'assets/audio/capture_sting.mp3',
  defeat: 'assets/audio/defeat.mp3',
};

// What the SCHOOLNET PA can play (Announcements app). The built-in ones are music boxes made here; a
// recording replaces one through the manifest ("files": { "pa_song_twinkle": "assets/audio/x.mp3" } plus
// its id in "available"). Your own songs: drop the mp3s into assets/audio/songs/ and list them in the
// manifest's "songs": [{ "file": "assets/audio/songs/my-song.mp3", "title": "My song" }]; they show up
// after the built-ins (ids song_1, song_2… in that order).
export const SONGS = [
  { id: 'pa_song', title: 'Frère Jacques' },
  { id: 'pa_song_twinkle', title: 'Twinkle, Twinkle, Little Star' },
  { id: 'pa_song_birthday', title: 'Happy Birthday' },
  { id: 'pa_song_elise', title: 'Für Elise' },
  { id: 'pa_song_bridge', title: 'London Bridge' },
];

const MANIFEST_PATH = 'assets/audio/manifest.json';
const resolveAsset = (p) => {
  try {
    return new URL(p, new URL('./', import.meta.url)).href; // works from index.html and from _dev/ pages
  } catch {
    return p;
  }
};

// ---------------------------------------------------------------------------------------------
// Procedural DSP toolkit — renders Float32Arrays in plain JS (deterministic per sound key).
// ---------------------------------------------------------------------------------------------
let SR = 32000;
const TAU = Math.PI * 2;

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
let R = mulberry32(1);
const rand = (a = 0, b = 1) => a + (b - a) * R();
const pick = (list) => list[(R() * list.length) | 0];
const N = (sec) => Math.max(1, Math.round(sec * SR));
const arr = (sec) => new Float32Array(N(sec));
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function noise(sec, color = 'white') {
  const n = N(sec);
  const x = new Float32Array(n);
  if (color === 'white') {
    for (let i = 0; i < n; i++) x[i] = R() * 2 - 1;
  } else if (color === 'brown') {
    let b = 0;
    for (let i = 0; i < n; i++) {
      b = (b + (R() * 2 - 1) * 0.04) * 0.996;
      x[i] = b * 2.5;
    }
  } else {
    // pink (Paul Kellet, economy)
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = R() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      x[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
  }
  return x;
}

// RBJ biquad, in place. f sweeps exponentially from f0 to f1 over the buffer when f1 is given.
function bq(x, type, f0, q = 0.707, f1 = f0, gainDb = 0) {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  let b0 = 0, b1 = 0, b2 = 0, a1 = 0, a2 = 0;
  const n = x.length;
  const sweep = f1 !== f0;
  const ratio = f1 / f0;
  const coefs = (f) => {
    const w = (TAU * Math.min(Math.max(f, 10), SR * 0.45)) / SR;
    const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let B0, B1, B2, A0, A1, A2;
    if (type === 'lp') { B0 = (1 - cs) / 2; B1 = 1 - cs; B2 = B0; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
    else if (type === 'hp') { B0 = (1 + cs) / 2; B1 = -(1 + cs); B2 = B0; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
    else if (type === 'bp') { B0 = al; B1 = 0; B2 = -al; A0 = 1 + al; A1 = -2 * cs; A2 = 1 - al; }
    else {
      const A = Math.pow(10, gainDb / 40);
      B0 = 1 + al * A; B1 = -2 * cs; B2 = 1 - al * A; A0 = 1 + al / A; A1 = -2 * cs; A2 = 1 - al / A;
    }
    b0 = B0 / A0; b1 = B1 / A0; b2 = B2 / A0; a1 = A1 / A0; a2 = A2 / A0;
  };
  coefs(f0);
  for (let i = 0; i < n; i++) {
    if (sweep && (i & 63) === 0) coefs(f0 * Math.pow(ratio, i / n));
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

// Linear attack, optional hold, exponential decay (tau seconds).
function envAD(x, attack, tau, hold = 0) {
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let g;
    if (t < attack) g = t / attack;
    else if (t < attack + hold) g = 1;
    else g = Math.exp(-(t - attack - hold) / tau);
    x[i] *= g;
  }
  return x;
}
// Arbitrary envelope: fn(u 0..1, tSeconds) → gain
function envShape(x, fn) {
  const n = x.length;
  for (let i = 0; i < n; i++) x[i] *= fn(i / n, i / SR);
  return x;
}

// Oscillator with exponential glide from f0 to f1 (glide time = whole buffer, or tau if given).
function tone(sec, f0, f1 = f0, shape = 'sine', tau = 0) {
  const n = N(sec);
  const x = new Float32Array(n);
  let ph = R();
  const ratio = f1 / f0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const f = tau > 0 ? f1 + (f0 - f1) * Math.exp(-t / tau) : f0 * Math.pow(ratio, i / n);
    ph += f / SR;
    ph -= Math.floor(ph);
    x[i] =
      shape === 'sine' ? Math.sin(TAU * ph)
      : shape === 'saw' ? 2 * ph - 1
      : shape === 'square' ? (ph < 0.5 ? 0.8 : -0.8)
      : 1 - 4 * Math.abs(ph - 0.5);
  }
  return x;
}

// Two-pole resonator (modal partial). Impulse in → decaying sine of amplitude ≈ amp.
function resonate(x, f, t60, amp = 1, lenSec = 0) {
  const n = Math.max(x.length, lenSec ? N(lenSec) : 0);
  const y = new Float32Array(n);
  if (f >= SR * 0.45) return y;
  const r = Math.exp(-6.91 / (t60 * SR));
  const w = (TAU * f) / SR;
  const c = 2 * r * Math.cos(w), r2 = r * r;
  const g = amp * Math.sin(w);
  let y1 = 0, y2 = 0;
  const xl = x.length;
  for (let i = 0; i < n; i++) {
    const v = (i < xl ? g * x[i] : 0) + c * y1 - r2 * y2;
    y2 = y1; y1 = v; y[i] = v;
  }
  return y;
}
function modal(excite, modes, lenSec) {
  const out = new Float32Array(Math.max(excite.length, N(lenSec)));
  for (const [f, a, t60] of modes) add(out, resonate(excite, f, t60, a, lenSec));
  return out;
}
function add(out, src, t0 = 0, gain = 1) {
  const o = Math.round(t0 * SR);
  const n = Math.min(src.length, out.length - o);
  for (let i = Math.max(0, -o); i < n; i++) out[o + i] += src[i] * gain;
  return out;
}
function softclip(x, drive = 1.5) {
  const k = Math.tanh(drive);
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(drive * x[i]) / k;
  return x;
}
function peakOf(x) {
  let p = 0;
  for (let i = 0; i < x.length; i++) {
    const a = Math.abs(x[i]);
    if (a > p) p = a;
  }
  return p;
}
function norm(x, target = 0.8) {
  const p = peakOf(x);
  if (p > 1e-9) {
    const g = target / p;
    for (let i = 0; i < x.length; i++) x[i] *= g;
  }
  return x;
}
function normStereo(L, Rr, target = 0.8) {
  const p = Math.max(peakOf(L), peakOf(Rr));
  if (p > 1e-9) {
    const g = target / p;
    for (let i = 0; i < L.length; i++) L[i] *= g;
    for (let i = 0; i < Rr.length; i++) Rr[i] *= g;
  }
  return [L, Rr];
}
// x has length L+F samples → returns L samples whose end flows seamlessly into its start.
function loopify(x, fadeSec) {
  const F = N(fadeSec);
  const L = x.length - F;
  const out = x.slice(0, L);
  for (let i = 0; i < F; i++) {
    const th = (i / F) * (Math.PI / 2);
    out[i] = x[i] * Math.sin(th) + x[L + i] * Math.cos(th);
  }
  return out;
}
function click(out, t0, amp, f = 3000, tau = 0.003, type = 'bp') {
  const c = noise(Math.max(0.01, tau * 6));
  envAD(c, 0.0004, tau);
  bq(c, type, f, 1.1);
  add(out, c, t0, amp);
}
function latch(out, t0, amp) {
  const c = noise(0.02);
  envAD(c, 0.0005, 0.004);
  bq(c, 'bp', rand(2400, 3200), 1.2);
  add(out, c, t0, amp);
  add(out, resonate(c, rand(1500, 1900), 0.06, 1, 0.12), t0, amp * 2.5);
}
function thump(out, t0, amp, f0, f1, tau, len = 0.4) {
  const s = tone(Math.max(len, tau * 7), f0, f1, 'sine', tau * 0.8); // ≥ 7τ so the tail never clicks
  envAD(s, 0.002, tau);
  add(out, s, t0, amp);
}
function burst(out, t0, amp, sec, attack, tau, type, f, q = 0.8, f1) {
  const b = noise(sec);
  envAD(b, attack, tau);
  if (type) bq(b, type, f, q, f1 ?? f);
  add(out, b, t0, amp);
}
function bellNote(out, t0, f, amp, partials, attack = 0.003) {
  for (const [ratio, a, t60] of partials) {
    const fr = f * ratio;
    if (fr >= SR * 0.45) continue;
    const d = Math.min(t60 * 1.1, out.length / SR - t0);
    if (d <= 0) continue;
    const s = tone(d, fr);
    envAD(s, attack, t60 / 6.91);
    add(out, s, t0, amp * a);
  }
}

// ---------------------------------------------------------------------------------------------
// Procedural sound generators. key → { sr, fn() → variants[] } ; a variant is Float32Array or [L, R].
// ---------------------------------------------------------------------------------------------
const GEN = {};
const def = (key, sr, fn) => (GEN[key] = { sr, fn });

const SURFACES = {
  lino: { bp: 1100, q: 0.9, tau: 0.026, body: 115, bodyAmp: 0.55, click: 0.25, squeak: true },
  tile: { bp: 2300, q: 1.1, tau: 0.018, body: 170, bodyAmp: 0.35, click: 0.6, ring: [3150, 0.07] },
  wood: { bp: 700, q: 1.0, tau: 0.035, body: 140, bodyAmp: 0.8, click: 0.15, ring: [430, 0.12] },
  concrete: { bp: 1500, q: 0.8, tau: 0.028, body: 95, bodyAmp: 0.45, click: 0.4, grit: true },
  carpet: { bp: 520, q: 0.6, tau: 0.045, body: 85, bodyAmp: 0.4, click: 0, lp: 1100 },
};
function genFootstep(p, v) {
  const out = arr(0.32);
  const hit = (t0, amp, fMul) => {
    burst(out, t0, amp * 1.6, 0.12, 0.0015, p.tau, 'bp', p.bp * fMul * rand(0.85, 1.15), p.q);
    thump(out, t0, amp * p.bodyAmp, p.body * rand(0.9, 1.1), p.body * 0.7, 0.025, 0.12);
    if (p.click) click(out, t0, amp * p.click, 3800, 0.0025, 'hp');
    if (p.ring) {
      const e = noise(0.006);
      add(out, resonate(e, p.ring[0] * rand(0.95, 1.05), p.ring[1], 1, 0.15), t0, amp * 0.5);
    }
    if (p.grit) for (let k = 0; k < 12; k++) click(out, t0 + rand(0, 0.05), amp * rand(0.05, 0.25), 3000, 0.0012, 'hp');
  };
  hit(0, 1, 1);
  hit(rand(0.045, 0.075), rand(0.35, 0.55), 1.35);
  if (p.squeak && v === 2) {
    const s = tone(0.05, 1900, 2250);
    envShape(s, (u) => Math.sin(Math.PI * u));
    add(out, s, rand(0.06, 0.09), 0.08);
  }
  if (p.lp) bq(out, 'lp', p.lp, 0.7);
  return norm(out, 0.8);
}
for (const [s, p] of Object.entries(SURFACES)) def('footstep_' + s, 32000, () => [0, 1, 2, 3].map((v) => genFootstep(p, v)));

def('scuff', 32000, () =>
  [0, 1, 2].map(() => {
    const x = noise(0.18);
    envAD(x, 0.02, 0.05);
    bq(x, 'bp', rand(2000, 3000), 0.8, rand(1200, 1600));
    return norm(x, 0.7);
  }),
);

def('enemy_step', 32000, () =>
  [0, 1, 2, 3].map(() => {
    const out = arr(0.55);
    thump(out, 0, 1, rand(70, 82), 40, 0.09, 0.35);
    burst(out, 0, 1.2, 0.2, 0.002, 0.045, 'lp', 500);
    burst(out, 0, 0.6, 0.05, 0.001, 0.012, 'bp', rand(800, 1100), 1.2);
    thump(out, rand(0.03, 0.05), 0.4, 60, 45, 0.05, 0.2);
    const sc = noise(0.2);
    envShape(sc, (u) => Math.sin(Math.PI * u) ** 2);
    bq(sc, 'bp', rand(1500, 2100), 0.9);
    add(out, sc, rand(0.06, 0.1), 0.22);
    softclip(out, 1.4);
    return norm(out, 0.85);
  }),
);

def('keys_jingle', 32000, () =>
  [0, 1, 2].map(() => {
    const out = arr(0.8);
    const hits = 12 + ((R() * 8) | 0);
    for (let h = 0; h < hits; h++) {
      const late = R() > 0.6;
      const t0 = late ? rand(0.22, 0.5) : rand(0, 0.18);
      const amp = rand(0.15, 0.6) * (late ? 0.6 : 1);
      for (let k = 0; k < 3; k++) {
        const f = rand(2200, 7400);
        const d = rand(0.05, 0.22);
        const s = tone(d, f, f * rand(0.995, 1.005));
        envAD(s, 0.0005, d / 4);
        add(out, s, t0, amp * rand(0.3, 1));
      }
      click(out, t0, amp * 0.4, 5000, 0.001, 'hp');
    }
    bq(out, 'hp', 1500, 0.7);
    return norm(out, 0.75);
  }),
);

def('door_open', 32000, () =>
  [0, 1].map(() => {
    const out = arr(1.1);
    latch(out, 0, 1);
    latch(out, rand(0.07, 0.1), 0.6);
    const w = noise(0.9);
    envShape(w, (u) => Math.sin(Math.PI * Math.min(1, u * 1.25)) ** 2);
    bq(w, 'lp', 300, 0.7, 1100);
    add(out, w, 0.12, 0.6);
    thump(out, 0.1, 0.25, 130, 100, 0.05, 0.25);
    return norm(out, 0.8);
  }),
);

def('door_creak', 32000, () =>
  [0, 1].map(() => {
    const dur = rand(1.0, 1.5);
    const exc = arr(dur);
    let t = 0.03;
    const f0 = rand(40, 60), target = rand(75, 125);
    while (t < dur - 0.1) {
      const u = t / dur;
      const f = f0 + (target - f0) * Math.sin(Math.PI * u) + rand(-6, 6);
      const a = Math.sin(Math.PI * Math.min(1, u * 1.2)) * rand(0.6, 1);
      const i = Math.round(t * SR);
      exc[i] += a;
      if (i + 1 < exc.length) exc[i + 1] -= a * 0.5;
      t += 1 / f;
    }
    const out = arr(dur);
    add(out, resonate(exc, rand(650, 800), 0.05, 1));
    add(out, resonate(exc, rand(1300, 1600), 0.04, 0.7));
    add(out, resonate(exc, rand(2400, 2900), 0.03, 0.4));
    add(out, exc, 0, 0.012);
    return norm(out, 0.75);
  }),
);

def('door_close', 32000, () =>
  [0, 1].map(() => {
    const out = arr(1.1);
    const t = 0.1;
    const w = noise(0.14);
    envShape(w, (u) => u * u);
    bq(w, 'lp', 600);
    add(out, w, 0, 0.25);
    thump(out, t, 1, 68, 42, 0.12, 0.5);
    burst(out, t, 1.1, 0.3, 0.001, 0.05, 'lp', 900);
    latch(out, t + 0.012, 0.8);
    for (let k = 0; k < 3; k++) latch(out, t + rand(0.06, 0.16), rand(0.1, 0.3));
    softclip(out, 1.3);
    return norm(out, 0.85);
  }),
);

def('door_locked', 32000, () =>
  [0, 1].map(() => {
    const out = arr(1.0);
    const times = [0, rand(0.13, 0.17), rand(0.3, 0.36), rand(0.44, 0.5)];
    times.forEach((t, i) => {
      const a = i === 0 ? 0.5 : rand(0.75, 1);
      burst(out, t, a, 0.03, 0.0005, 0.008, 'bp', rand(1800, 2600), 1.0);
      const e = noise(0.006);
      add(out, resonate(e, rand(1300, 1500), 0.07, 1, 0.15), t, a * 1.2);
      add(out, resonate(e, rand(2900, 3300), 0.05, 1, 0.12), t, a * 0.8);
      thump(out, t, a * 0.6, 175, 140, 0.035, 0.12);
    });
    softclip(out, 1.2);
    return norm(out, 0.85);
  }),
);

const LOCKER_MODES = [
  [187, 1, 0.9], [412, 0.6, 0.7], [693, 0.5, 0.6], [1131, 0.35, 0.45], [1712, 0.25, 0.35], [2390, 0.15, 0.25],
];
function sheet(out, t0, amp, len) {
  const e = noise(0.012);
  envAD(e, 0.0005, 0.004);
  const m = modal(e, LOCKER_MODES.map(([f, a, t]) => [f * rand(0.97, 1.03), a, t]), len);
  add(out, m, t0, amp);
}
def('locker_open', 32000, () => [
  (() => {
    const out = arr(1.3);
    latch(out, 0, 0.8);
    const s = tone(0.22, 1700, 2150);
    envShape(s, (u, t) => Math.sin(Math.PI * u) * (0.75 + 0.25 * Math.sin(TAU * 28 * t)));
    add(out, s, 0.05, 0.1);
    sheet(out, 0.12, 0.7, 1.15);
    return norm(out, 0.8);
  })(),
]);
def('locker_close', 32000, () => [
  (() => {
    const out = arr(1.2);
    sheet(out, 0, 1.2, 1.1);
    thump(out, 0, 0.5, 95, 70, 0.05, 0.2);
    latch(out, 0.05, 0.9);
    latch(out, 0.085, 0.5);
    softclip(out, 1.6);
    return norm(out, 0.85);
  })(),
]);

def('cloth', 32000, () =>
  [0, 1].map(() => {
    const x = noise(0.8);
    const bumps = [];
    for (let k = 0; k < 7; k++) bumps.push([rand(0.05, 0.65), rand(0.03, 0.12), rand(0.3, 1)]);
    envShape(x, (u, t) => {
      let g = 0;
      for (const [c, w, a] of bumps) g += a * Math.exp(-(((t - c) / w) ** 2));
      return Math.min(1, g);
    });
    bq(x, 'bp', 2400, 0.6);
    return norm(x, 0.7);
  }),
);

def('pickup', 32000, () => [
  (() => {
    const out = arr(2.0);
    const P = [[1, 1, 1.3], [2.76, 0.22, 0.45], [5.4, 0.07, 0.2]];
    bellNote(out, 0, 880, 1, P, 0.004);
    bellNote(out, 0.004, 882.5, 0.4, P, 0.004);
    bellNote(out, 0.17, 1244.5, 0.8, P, 0.004);
    bellNote(out, 0.174, 1247, 0.35, P, 0.004);
    for (let k = 0; k < 6; k++) {
      const s = tone(1.2, rand(4200, 7200));
      const ph = rand(0, TAU);
      envShape(s, (u, t) => (0.5 + 0.5 * Math.sin(TAU * 9 * t + ph)) * Math.exp(-t / 0.35) * Math.min(1, t / 0.03));
      add(out, s, 0.05 + k * 0.02, 0.05);
    }
    return norm(out, 0.8);
  })(),
]);

def('flashlight_click', 32000, () => [
  (() => {
    const out = arr(0.14);
    click(out, 0, 1, 3500, 0.003, 'hp');
    add(out, resonate(noise(0.004), 3400, 0.02, 1, 0.05), 0, 0.6);
    thump(out, 0, 0.3, 900, 700, 0.006, 0.03);
    click(out, 0.05, 0.6, 2800, 0.0025, 'hp');
    add(out, resonate(noise(0.004), 2900, 0.02, 1, 0.05), 0.05, 0.4);
    return norm(out, 0.75);
  })(),
]);

// --- ambience ---
def('roomtone', 16000, () => {
  const L = 12, F = 1.5;
  const ch = (ph) => {
    const x = noise(L + F, 'brown');
    bq(x, 'lp', 170, 0.6);
    norm(x, 1);
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      x[i] = x[i] * (0.72 + 0.28 * Math.sin((TAU * t) / L + ph)) +
        0.035 * Math.sin(TAU * 50 * t) + 0.014 * Math.sin(TAU * 100 * t + 0.6);
    }
    return loopify(x, F);
  };
  return [normStereo(ch(0), ch(2.1), 0.6)];
});

def('buzz', 32000, () => {
  const x = arr(3);
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    const s = Math.sin(TAU * 100 * t);
    x[i] = Math.tanh(3 * s) * 0.5 + 0.3 * Math.sin(TAU * 200 * t + 0.4) + 0.12 * Math.sin(TAU * 300 * t + 1.1) +
      0.05 * Math.sin(TAU * 1000 * t) * (0.6 + 0.4 * Math.sin(TAU * 2 * t));
  }
  bq(x, 'hp', 80, 0.7);
  bq(x, 'lp', 3500, 0.7);
  const out = x.slice(N(1)); // steady state, exactly 200 periods of 100 Hz → seamless loop
  for (let k = 0; k < 14; k++) click(out, rand(0, 1.98), rand(0.1, 0.35), 3000, 0.0008, 'hp');
  return [norm(out, 0.7)];
});

def('bang_distant', 22050, () => {
  const v = [];
  { // metal bang
    const out = arr(2.6);
    const e = noise(0.015);
    envAD(e, 0.0005, 0.005);
    add(out, modal(e, [[92, 1, 1.8], [143, 0.8, 1.5], [221, 0.7, 1.2], [318, 0.5, 1.0], [467, 0.4, 0.8], [610, 0.3, 0.6]], 2.6));
    thump(out, 0, 0.6, 55, 40, 0.15, 0.6);
    bq(out, 'lp', 1500);
    v.push(norm(out, 0.85));
  }
  { // far door slam
    const out = arr(1.8);
    thump(out, 0, 1, 60, 40, 0.18, 0.7);
    burst(out, 0, 1, 0.4, 0.001, 0.08, 'lp', 700);
    for (let k = 0; k < 3; k++) burst(out, rand(0.02, 0.2), 0.2, 0.02, 0.0005, 0.005, 'bp', 1400);
    bq(out, 'lp', 700);
    v.push(norm(out, 0.85));
  }
  { // pipe knocks
    const out = arr(2.6);
    const times = [0, rand(0.3, 0.4), rand(0.58, 0.7), rand(1.1, 1.3)];
    for (const t of times) {
      const e = noise(0.004);
      add(out, modal(e, [[310, 1, 0.5], [651, 0.5, 0.35], [1147, 0.3, 0.2]], 0.7), t, rand(0.6, 1));
    }
    bq(out, 'lp', 2500);
    v.push(norm(out, 0.85));
  }
  { // furniture drag
    const out = arr(2.3);
    const x = noise(2.2);
    let gate = 1, next = 0;
    envShape(x, (u, t) => {
      if (t >= next) { gate = rand(0.3, 1); next = t + 1 / rand(20, 40); }
      return gate * Math.sin(Math.PI * u) ** 0.7;
    });
    bq(x, 'bp', 420, 2, 300);
    add(out, x);
    bq(out, 'lp', 900);
    v.push(norm(out, 0.8));
  }
  { // something falling and bouncing
    const out = arr(2.0);
    let t = 0, a = 1, gap = 0.25;
    for (let k = 0; k < 7; k++) {
      thump(out, t, a, rand(200, 240), 170, 0.03, 0.12);
      click(out, t, a * 0.5, 1800, 0.004);
      t += gap; gap *= 0.7; a *= 0.68;
    }
    bq(out, 'lp', 1800);
    v.push(norm(out, 0.8));
  }
  { // heavy steps on the floor above
    const out = arr(2.2);
    for (let k = 0; k < 3; k++) {
      thump(out, k * rand(0.55, 0.65), 1, 55, 38, 0.12, 0.5);
      burst(out, k * 0.6, 0.6, 0.2, 0.002, 0.05, 'lp', 250);
    }
    bq(out, 'lp', 260);
    v.push(norm(out, 0.85));
  }
  return v;
});

def('flicker', 32000, () =>
  [0, 1].map(() => {
    const out = arr(0.8);
    let t = 0;
    while (t < 0.65) {
      const on = rand(0.02, 0.09);
      const b = tone(on, 100, 100, 'saw');
      envShape(b, (u) => Math.min(1, u * 12) * Math.min(1, (1 - u) * 12));
      bq(b, 'bp', 900, 0.6);
      add(out, b, t, rand(0.3, 0.7));
      click(out, t, rand(0.3, 0.8), 2500, 0.002, 'hp');
      burst(out, t, rand(0.1, 0.4), 0.03, 0.001, 0.008, 'bp', 3500, 1.5);
      t += on + rand(0.01, 0.08);
    }
    return norm(out, 0.75);
  }),
);

// --- bells / PA ---
def('bell', 32000, () => [
  (() => {
    const len = 4.8;
    const exc = arr(len);
    let t = 0;
    const stop = rand(3.2, 3.5);
    while (t < stop) {
      const i = Math.round(t * SR);
      exc[i] += rand(0.8, 1) * Math.min(1, (t + 0.02) / 0.08);
      t += 1 / rand(17, 19.5);
    }
    const out = modal(exc, [[1180, 1, 2.0], [1186, 0.5, 2.2], [2290, 0.75, 1.4], [3420, 0.55, 1.0], [4860, 0.35, 0.7], [6290, 0.2, 0.5]], len);
    const clk = exc.slice();
    bq(clk, 'bp', 2600, 0.7);
    const pk = peakOf(out);
    add(out, clk, 0, pk * 0.5);
    // mechanical rattle of the striker at the strike rate
    const rat = noise(stop + 0.05);
    envShape(rat, (u, tt) => 0.5 + 0.5 * Math.sin(TAU * 18 * tt));
    bq(rat, 'bp', 1600, 1.5);
    add(out, rat, 0, pk * 0.08);
    softclip(norm(out, 1), 1.5);
    return norm(out, 0.85);
  })(),
]);

def('pa_chime', 32000, () => [
  (() => {
    const out = arr(2.8);
    const P = [[1, 1, 1.6], [4, 0.15, 0.4], [10, 0.03, 0.15]];
    bellNote(out, 0, 784, 1, P);
    bellNote(out, 0.5, 659.3, 1, P);
    bellNote(out, 1.0, 523.3, 1, P);
    envShape(out, (u, t) => 0.9 + 0.1 * Math.sin(TAU * 5 * t));
    return norm(out, 0.8);
  })(),
]);

def('pa_static', 22050, () => {
  const L = 4, F = 0.5;
  const x = noise(L + F);
  bq(x, 'bp', 1800, 0.5);
  norm(x, 0.25);
  const n = x.length;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const sq = Math.sin(TAU * 50 * t) > 0 ? 1 : -1;
    x[i] = x[i] * (0.7 + 0.3 * Math.sin(TAU * 0.5 * t)) + 0.05 * sq + 0.02 * Math.sin(TAU * 150 * t);
  }
  const pops = arr(L + F);
  for (let k = 0; k < 40 * (L + F); k++) {
    const i = (R() * pops.length) | 0;
    const a = -Math.log(1 - R() * 0.999) * 0.15 * (R() < 0.5 ? -1 : 1);
    pops[i] += a;
    if (i + 1 < pops.length) pops[i + 1] -= a * 0.6;
  }
  bq(pops, 'hp', 1000);
  add(x, pops);
  return [norm(loopify(x, F), 0.6)];
});

// --- game stingers ---
def('exit_denied', 32000, () => [
  (() => {
    const out = arr(1.6);
    thump(out, 0, 1, 55, 38, 0.15, 0.6);
    burst(out, 0, 0.9, 0.2, 0.001, 0.05, 'lp', 600);
    const e = noise(0.01);
    add(out, modal(e, [[640, 1, 0.12], [1310, 0.7, 0.1], [2210, 0.4, 0.08]], 0.3), 0, 2);
    for (let k = 0; k < 6; k++) latch(out, rand(0.1, 0.4), rand(0.1, 0.3));
    const bz = tone(0.7, 110, 110, 'saw');
    add(bz, tone(0.7, 116, 116, 'saw'), 0, 0.7);
    envShape(bz, (u) => Math.min(1, u * 60) * Math.min(1, (1 - u) * 14));
    bq(bz, 'bp', 700, 1);
    add(out, bz, 0.15, 0.6);
    softclip(out, 1.4);
    return norm(out, 0.85);
  })(),
]);

def('exit_unlock', 32000, () => [
  (() => {
    const out = arr(1.8);
    for (let k = 0; k < 7; k++) {
      click(out, k * 0.035, 0.5, 3000, 0.002);
      add(out, resonate(noise(0.003), 2400, 0.02, 1, 0.04), k * 0.035, 0.3);
    }
    thump(out, 0.32, 0.9, 80, 60, 0.08, 0.3);
    const e = noise(0.01);
    add(out, modal(e, [[520, 1, 0.25], [1100, 0.6, 0.2], [1830, 0.4, 0.15]], 0.5), 0.32, 1.5);
    const sl = noise(0.45);
    envShape(sl, (u) => Math.sin(Math.PI * u) ** 0.8);
    bq(sl, 'bp', 900, 1.5, 500);
    add(out, sl, 0.45, 0.35);
    thump(out, 0.92, 1, 70, 50, 0.1, 0.4);
    latch(out, 0.92, 0.7);
    softclip(out, 1.2);
    return norm(out, 0.85);
  })(),
]);

def('escape', 32000, () => {
  const len = 5.5;
  const L = arr(len), Rt = arr(len);
  const crash = arr(1.2);
  burst(crash, 0, 1, 1.0, 0.001, 0.25, 'lp', 2500);
  thump(crash, 0, 1, 50, 35, 0.3, 1.0);
  const e = noise(0.02);
  add(crash, modal(e, [[210, 1, 0.8], [480, 0.7, 0.6], [870, 0.5, 0.45], [1390, 0.3, 0.3]], 1.2), 0, 1.5);
  thump(crash, 0.35, 0.7, 70, 45, 0.12, 0.4);
  add(L, crash); add(Rt, crash, 0, 0.9);
  for (const [ch, ph] of [[L, 0], [Rt, 1.7]]) {
    const w = noise(len - 0.2);
    envShape(w, (u, t) => Math.min(1, t / 0.6) * (0.6 + 0.4 * Math.sin(TAU * 0.37 * t + ph)) * (1 - u * 0.5));
    bq(w, 'bp', 400, 0.5, 900);
    add(ch, w, 0.2, 0.45);
    // crickets
    for (let t = 1.2 + ph * 0.2; t < len - 0.3; t += rand(0.5, 0.75)) {
      for (let k = 0; k < 3; k++) {
        const c = tone(0.018, 4600 + ph * 80);
        envShape(c, (u) => Math.sin(Math.PI * u));
        add(ch, c, t + k * 0.034, 0.035);
      }
    }
  }
  return [normStereo(L, Rt, 0.9)];
});

function saw(sec, f) {
  return tone(sec, f, f, 'saw');
}
def('capture_sting', 32000, () => {
  const len = 2.8;
  const L = arr(len), Rt = arr(len);
  const freqs = [65.4, 69.3, 92.5, 138.6, 196, 207.7, 277.2, 293.7];
  freqs.forEach((f, i) => {
    const s = saw(len, f * rand(0.995, 1.005));
    envAD(s, 0.005, 0.5);
    add(i % 2 ? L : Rt, s, 0, 0.35);
    add(i % 2 ? Rt : L, s, 0, 0.2);
  });
  for (const ch of [L, Rt]) {
    burst(ch, 0, 0.9, 0.8, 0.001, 0.25, 'hp', 300);
    thump(ch, 0, 0.9, 45, 28, 0.6, 2.0);
    const sc = tone(1.6, 2960, 2700);
    envAD(sc, 0.01, 0.6);
    add(ch, sc, 0, 0.12);
    bq(ch, 'lp', 4500);
    softclip(norm(ch, 1), 2.0);
  }
  return [normStereo(L, Rt, 0.9)];
});

function groan(out, t0, amp, len) {
  const x = arr(len);
  let ph = 0, f = rand(38, 44), nextJ = 0, jit = 1;
  for (let i = 0; i < x.length; i++) {
    const t = i / SR;
    if (t >= nextJ) { jit = rand(0.85, 1.15); nextJ = t + rand(0.02, 0.06); }
    const ff = (f + 14 * (t / len)) * jit;
    ph += ff / SR; ph -= Math.floor(ph);
    x[i] = 2 * ph - 1;
  }
  const a = bq(x.slice(), 'bp', 260, 3);
  const b = bq(x, 'bp', 520, 4);
  add(a, b, 0, 0.6);
  envShape(a, (u) => Math.min(1, u * 4) * Math.exp(-Math.max(0, u - 0.25) * 3));
  add(out, a, t0, amp);
}
def('transform', 22050, () => {
  const len = 6;
  const L = arr(len), Rt = arr(len);
  for (const [ch, ph] of [[L, 0], [Rt, 1]]) {
    const r = noise(len, 'brown');
    bq(r, 'lp', 90, 0.7);
    norm(r, 1);
    envShape(r, (u, t) => Math.min(1, t / 1.5) * Math.min(1, (len - t) / 1.5));
    add(ch, r, 0, 0.6);
    const sub = tone(len, 32 + ph, 28);
    envShape(sub, (u, t) => Math.min(1, t / 1.2) * Math.min(1, (len - t) / 2));
    add(ch, sub, 0, 0.45);
    const w = noise(2.2);
    envShape(w, (u) => Math.pow(u, 3));
    bq(w, 'bp', 300, 0.8, 4000);
    add(ch, w, 0, 0.7);
    thump(ch, 2.2, 0.9, 50, 30, 0.4, 1.5);
    groan(ch, 2.6 + ph * 0.1, 0.5, 1.4);
    groan(ch, 3.8 - ph * 0.1, 0.4, 1.2);
  }
  return [normStereo(L, Rt, 0.9)];
});

def('transform_warning', 22050, () => [
  (() => {
    const len = 4.2;
    const out = noise(len, 'brown');
    bq(out, 'lp', 70, 0.7, 160);
    norm(out, 1);
    const sub = tone(len, 35, 41);
    add(out, sub, 0, 0.6);
    const wh = tone(len, 5200, 6000);
    add(out, wh, 0, 0.012);
    envShape(out, (u, t) => (u * u) * Math.min(1, (len - t) / 0.3));
    const g = arr(len);
    groan(g, 2.5, 0.25, 1.2);
    add(out, g);
    return norm(out, 0.85);
  })(),
]);

const MBOX = [[1, 1, 1.6], [2, 0.2, 0.6], [5.4, 0.1, 0.2]];
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
def('victory', 32000, () => {
  const len = 6;
  const L = arr(len), Rt = arr(len);
  const phrase = [[69, 0], [76, 0.35], [72, 0.7], [71, 1.05], [69, 1.4], [76, 2.0], [79, 2.35], [84, 2.7]];
  phrase.forEach(([m, t], i) => bellNote(i % 2 ? L : Rt, t, midi(m), i === phrase.length - 1 ? 1.2 : 0.9, MBOX, 0.002));
  for (const [ch, ph] of [[L, 0], [Rt, 0.5]]) {
    for (const m of [48, 52, 55, 60]) {
      const s = tone(len - 2, midi(m) * (1 + ph * 0.002));
      envShape(s, (u, t) => Math.min(1, t / 1.5) * Math.min(1, (len - 2 - t) / 1.2) * (0.9 + 0.1 * Math.sin(TAU * 0.3 * t + ph)));
      add(ch, s, 2.0, 0.12);
    }
  }
  return [normStereo(L, Rt, 0.8)];
});

def('defeat', 22050, () => [
  (() => {
    const len = 7;
    const out = arr(len);
    for (const [f, d] of [[55, 1], [55 * 1.009, 1], [82.4 * 0.995, 0.6]]) {
      const s = tone(len, f, f / 2, 'saw');
      add(out, s, 0, 0.3 * d);
    }
    bq(out, 'lp', 400, 0.8, 120);
    envShape(out, (u, t) => Math.min(1, t / 0.3) * Math.min(1, (len - t) / 2));
    const bell = arr(len);
    bellNote(bell, 1.8, 620, 0.5, [[1, 1, 4], [2.4, 0.6, 2.5], [3.9, 0.4, 1.5], [5.1, 0.25, 1]], 0.002);
    bq(bell, 'lp', 2500);
    add(out, bell);
    const w = noise(len, 'pink');
    bq(w, 'lp', 500);
    envShape(w, (u) => Math.sin(Math.PI * u));
    add(out, w, 0, 0.15);
    return norm(out, 0.85);
  })(),
]);

def('spotted', 32000, () => {
  const len = 1.4;
  const L = arr(len), Rt = arr(len);
  [440, 466.2, 523.3, 554.4, 220, 233.1].forEach((f, i) => {
    const s = saw(len, f * rand(0.997, 1.003));
    envAD(s, 0.004, 0.35);
    add(i % 2 ? L : Rt, s, 0, 0.3);
    add(i % 2 ? Rt : L, s, 0, 0.15);
  });
  for (const ch of [L, Rt]) {
    bq(ch, 'bp', 1500, 0.5);
    burst(ch, 0, 0.7, 0.3, 0.001, 0.08, 'hp', 1500);
    thump(ch, 0, 0.9, 60, 35, 0.25, 1.0);
    const sc = tone(1.0, 1900, 2010);
    envAD(sc, 0.01, 0.5);
    add(ch, sc, 0, 0.12);
    softclip(norm(ch, 1), 1.6);
  }
  return [normStereo(L, Rt, 0.9)];
});

def('room000', 22050, () => [
  (() => {
    const len = 5;
    const out = arr(len);
    thump(out, 0, 1, 45, 28, 0.6, 2);
    burst(out, 0, 0.6, 1, 0.001, 0.3, 'lp', 300);
    const e = noise(0.02);
    add(out, modal(e, [[180, 1, 1.0], [390, 0.6, 0.8]], 1.5), 0, 1.2);
    for (const f of [30, 30.5]) {
      const s = tone(len, f);
      envShape(s, (u, t) => Math.min(1, Math.max(0, t - 0.3) / 1.5) * Math.min(1, (len - t) / 1));
      add(out, s, 0, 0.35);
    }
    bellNote(out, 1.2, 1567, 0.06, [[1, 1, 3]], 0.01);
    bq(out, 'lp', 1800);
    return norm(out, 0.85);
  })(),
]);

// --- body ---
def('heartbeat', 32000, () => [
  (() => {
    const out = arr(0.7);
    thump(out, 0, 1, 52, 40, 0.06, 0.3);
    burst(out, 0, 0.3, 0.1, 0.002, 0.03, 'lp', 120);
    thump(out, 0.28, 0.7, 48, 38, 0.05, 0.3);
    return norm(out, 0.9);
  })(),
]);
function breathSeg(out, t0, dur, amp, f, q) {
  const x = noise(dur);
  envShape(x, (u, t) => Math.sin(Math.PI * u) ** 2 * (0.85 + 0.15 * Math.sin(TAU * 7 * t)));
  bq(x, 'bp', f, q);
  bq(x, 'lp', 3800, 0.7);
  add(out, x, t0, amp);
}
def('breath', 32000, () => [
  (() => {
    const out = arr(2.6);
    breathSeg(out, 0, 0.9, 0.5, 1300, 0.9);
    breathSeg(out, 0.05, 0.8, 0.12, 2400, 1.5);
    breathSeg(out, 1.05, 1.35, 0.7, 900, 0.8);
    return norm(out, 0.6);
  })(),
]);
def('breath_exhausted', 32000, () => [
  (() => {
    const out = arr(1.7);
    const segs = [[0, 0.32, 'in'], [0.36, 0.42, 'out'], [0.84, 0.3, 'in'], [1.18, 0.44, 'out']];
    for (const [t, d, k] of segs) {
      if (k === 'in') breathSeg(out, t, d, 0.6, 1500, 1.2);
      else {
        breathSeg(out, t, d, 0.9, 1000, 0.9);
        const v = saw(d, 110 * rand(0.95, 1.05));
        envShape(v, (u) => Math.sin(Math.PI * u) ** 2);
        bq(v, 'bp', 600, 2);
        add(out, v, t, 0.12);
      }
    }
    return norm(out, 0.75);
  })(),
]);
def('exhale', 32000, () => [
  (() => {
    const out = arr(1.5);
    const x = noise(1.4);
    envShape(x, (u, t) => Math.min(1, t / 0.08) * Math.exp(-t / 0.5) * (0.8 + 0.2 * Math.sin(TAU * 9 * t)));
    bq(x, 'bp', 800, 0.8, 600);
    add(out, x);
    const v = saw(1.0, 95);
    envAD(v, 0.05, 0.3);
    bq(v, 'bp', 500, 2);
    add(out, v, 0, 0.05);
    return norm(out, 0.7);
  })(),
]);

// --- UI ---
def('ui_hover', 32000, () => [
  (() => {
    const out = arr(0.06);
    click(out, 0, 0.5, 3500, 0.002, 'hp');
    const s = tone(0.03, 2400);
    envAD(s, 0.0005, 0.008);
    add(out, s, 0, 0.3);
    return norm(out, 0.5);
  })(),
]);
def('ui_select', 32000, () => [
  (() => {
    const out = arr(0.25);
    click(out, 0, 0.6, 1800, 0.004);
    thump(out, 0, 0.8, 160, 110, 0.04, 0.2);
    add(out, resonate(noise(0.004), 820, 0.08, 1, 0.15), 0, 0.5);
    return norm(out, 0.7);
  })(),
]);
def('ui_back', 32000, () => [
  (() => {
    const out = arr(0.22);
    click(out, 0, 0.4, 1200, 0.004);
    thump(out, 0, 0.8, 300, 180, 0.05, 0.2);
    return norm(out, 0.6);
  })(),
]);
def('ui_toggle', 32000, () => [
  (() => {
    const out = arr(0.15);
    click(out, 0, 0.7, 2600, 0.0025);
    click(out, 0.045, 0.5, 3100, 0.0025);
    return norm(out, 0.6);
  })(),
]);

// --- caretaker hum (procedural fallback for the 'hum' line) ---
def('caretaker_hum', 22050, () => [
  (() => {
    const notes = [[0, 0, 0.85], [3, 0.85, 0.55], [2, 1.4, 0.55], [-2, 1.95, 0.9], [0, 2.85, 1.6]];
    const total = 4.9;
    const n = N(total);
    const x = new Float32Array(n);
    const base = 98;
    let semis = 0, ph = 0;
    const H = 10;
    const hAmp = [];
    for (let k = 1; k <= H; k++) hAmp.push(1 / Math.pow(k, 1.3));
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      let cur = notes[0];
      for (const nt of notes) if (t >= nt[1]) cur = nt;
      semis += (cur[0] - semis) * (1 - Math.exp(-1 / (0.05 * SR)));
      const inNote = t - cur[1];
      const vib = 1 + 0.006 * Math.sin(TAU * 5 * t) * Math.min(1, Math.max(0, inNote - 0.2) / 0.2);
      const f = base * Math.pow(2, semis / 12) * vib;
      ph += f / SR;
      ph -= Math.floor(ph);
      let s = 0;
      for (let k = 0; k < H; k++) s += hAmp[k] * Math.sin(TAU * (k + 1) * ph);
      const edge = Math.min(1, inNote / 0.08) * Math.min(1, (cur[1] + cur[2] - t) / 0.12);
      const env = (0.7 + 0.3 * Math.max(0, edge)) * Math.min(1, t / 0.2) * Math.min(1, (total - t) / 0.5);
      x[i] = s * env;
    }
    const f1 = bq(x.slice(), 'bp', 300, 3);
    const f2 = bq(x.slice(), 'bp', 900, 5);
    const dry = bq(x, 'lp', 1200);
    add(f1, f2, 0, 0.2);
    add(f1, dry, 0, 0.3);
    const br = noise(total);
    bq(br, 'bp', 1500, 1);
    add(f1, br, 0, 0.02);
    return norm(f1, 0.8);
  })(),
]);

// The caretaker burps now and then (beta request). A rough, low glottal pulse train with jitter and
// vocal-fry flutter through two vowel formants ("awrp"), pitch sagging over the burp. 3 variants.
def('caretaker_burp', 22050, () => [0, 1, 2].map((v) => {
  const total = [0.75, 1.05, 0.55][v];
  const f0 = [78, 66, 92][v];
  const n = N(total);
  const x = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const u = t / total;
    const sag = 1 - 0.28 * u;
    const flutter = 1 + 0.18 * Math.sin(TAU * (11 + v * 3) * t) * (R() * 0.6 + 0.4);
    const f = f0 * sag * flutter * (1 + (R() - 0.5) * 0.12);
    ph += f / SR;
    let pulse = 0;
    if (ph >= 1) { ph -= 1; pulse = 1; }
    // glottal click + a little breath
    x[i] = pulse * (0.8 + R() * 0.4) + (R() * 2 - 1) * 0.04;
    const env = Math.min(1, t / 0.025) * Math.pow(Math.max(0, 1 - u), 0.6) * (0.75 + 0.25 * Math.sin(Math.PI * Math.min(1, u * 1.6)));
    x[i] *= env;
  }
  const f1 = bq(x.slice(), 'bp', [520, 460, 600][v], 4, [380, 330, 450][v]); // "aw" -> "uh"
  const f2 = bq(x.slice(), 'bp', [950, 860, 1100][v], 6, [760, 700, 880][v]);
  const body = bq(x, 'lp', 1400);
  add(f1, f2, 0, 0.55);
  add(f1, body, 0, 0.35);
  softclip(f1, 2.2);
  return norm(f1, 0.85);
}));

// He runs out of breath mid-chase (the outrun mechanic, voice line 'wheeze'). Procedural fallback for
// the recorded line: two ragged breaths, a rasp and a thin whistle on the way in, a low voiced groan
// on the way out. 2 variants.
def('caretaker_wheeze', 22050, () => [0, 1].map((v) => {
  const total = 2.7;
  const out = arr(total);
  const breaths = v ? [[0, 0.5, 0.62, 0.7], [1.42, 0.45, 1.95, 0.7]] : [[0, 0.6, 0.68, 0.62], [1.4, 0.5, 1.98, 0.66]];
  for (const [ti, li, te, le] of breaths) {
    const inh = bq(noise(li), 'bp', 1100, 2.5, 2100);
    for (let i = 0; i < inh.length; i++) {
      const u = i / inh.length;
      inh[i] *= Math.sin(Math.PI * Math.min(1, u * 1.15)) * (0.7 + 0.3 * R());
    }
    add(out, inh, ti, 0.9);
    const wh = arr(li);
    let ph = 0;
    for (let i = 0; i < wh.length; i++) {
      const u = i / wh.length;
      ph += (1700 + 500 * u + 60 * Math.sin(TAU * 7 * u)) / SR;
      wh[i] = Math.sin(TAU * ph) * Math.sin(Math.PI * u) * 0.12;
    }
    add(out, wh, ti, 1);
    const exh = bq(noise(le), 'bp', 700, 1.6, 450);
    const gr = arr(le);
    let gp = 0;
    for (let i = 0; i < gr.length; i++) {
      gp += ((88 - 14 * (i / gr.length)) * (1 + (R() - 0.5) * 0.08)) / SR;
      if (gp >= 1) { gp -= 1; gr[i] = 1; }
    }
    const groan = bq(gr, 'bp', 420, 3, 360);
    for (let i = 0; i < exh.length; i++) {
      const u = i / exh.length;
      exh[i] = (exh[i] * 0.9 + groan[i] * 1.6) * Math.min(1, u / 0.08) * Math.pow(1 - u, 0.8);
    }
    add(out, exh, te, 0.9);
  }
  softclip(out, 1.6);
  return norm(out, 0.8);
}));

// The loose fuse fizzes and ticks: a positional loop at the fuse until it is picked up, so you can
// find it by ear (beta: "hard to find the fuse"). Seamless 2.4 s loop: a 100 Hz hum in whole cycles,
// random crackles (some in bursts) and a sizzle that swells and dies away within the loop.
def('fuse_crackle', 32000, () => [
  (() => {
    const total = 2.4;
    const n = N(total);
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      out[i] = 0.05 * Math.sin(TAU * 100 * t) + 0.025 * Math.sin(TAU * 200 * t) + 0.012 * Math.sin(TAU * 300 * t);
    }
    let t = 0.05;
    while (t < total - 0.1) {
      const burst = R() < 0.3 ? 3 + Math.floor(R() * 4) : 1;
      let tb = t;
      for (let b = 0; b < burst; b++) {
        const len = N(0.004 + R() * 0.012);
        const i0 = N(tb);
        const amp = 0.35 + R() * 0.65;
        for (let k = 0; k < len && i0 + k < n; k++) out[i0 + k] += (R() * 2 - 1) * amp * Math.exp(-k / (len * 0.3));
        tb += 0.012 + R() * 0.02;
      }
      t += 0.08 + R() * 0.35;
    }
    const sz = bq(noise(total), 'bp', 4200, 1.2);
    for (let i = 0; i < n; i++) out[i] += sz[i] * 0.18 * Math.pow(Math.sin((Math.PI * i) / n), 2);
    return norm(out, 0.7);
  })(),
]);

// ============================================================================ SCHOOLNET & tools
// The computers (keyboard, the old monitor powering on and off, login tones), the vending-machine can,
// eating the döner, Kaan's PlayStation (a loop) and the PA broadcast material: the song and a garbled
// distant announcement for when no recording is installed (see broadcast()).
def('key_clack', 32000, () => [0, 1, 2].map((v) => {
  const out = arr(0.09);
  const click = envAD(bq(noise(0.012), 'hp', 2500 + v * 600), 0.0005, 0.004);
  add(out, click, 0, 0.9);
  const thock = envAD(tone(0.05, 180 + v * 25, 120), 0.001, 0.012);
  add(out, thock, 0.002, 0.5);
  const rel = envAD(bq(noise(0.01), 'bp', 3200, 1.5), 0.0005, 0.003);
  add(out, rel, 0.05 + v * 0.008, 0.35);
  return norm(out, 0.7);
}));

def('crt_on', 32000, () => [
  (() => {
    const out = arr(1.2);
    add(out, envAD(tone(0.25, 70, 45), 0.002, 0.06), 0, 1);
    add(out, envAD(bq(noise(0.15), 'bp', 2500, 0.7), 0.001, 0.03), 0.01, 0.6);
    add(out, envShape(tone(1.1, 6000, 9500, 'sine', 0.25), (u) => Math.min(1, u * 6) * (1 - u)), 0.05, 0.05);
    add(out, envShape(tone(1.1, 60), (u) => Math.min(1, u * 4) * (1 - u)), 0.05, 0.25);
    return norm(out, 0.75);
  })(),
]);

def('crt_off', 32000, () => [
  (() => {
    const out = arr(0.45);
    add(out, envAD(tone(0.35, 2400, 80, 'sine', 0.06), 0.001, 0.09), 0, 0.7);
    add(out, envAD(bq(noise(0.05), 'bp', 1800, 0.8), 0.001, 0.012), 0, 0.5);
    return norm(out, 0.65);
  })(),
]);

def('sn_error', 32000, () => [
  (() => {
    const out = arr(0.5);
    for (const [t, f] of [[0, 196], [0.22, 165]]) add(out, envShape(tone(0.17, f, f, 'square'), (u) => Math.min(1, u * 30) * Math.min(1, (1 - u) * 12)), t, 0.6);
    return norm(bq(out, 'lp', 2400), 0.7);
  })(),
]);

def('sn_ok', 32000, () => [
  (() => {
    const out = arr(0.35);
    add(out, envAD(tone(0.08, 880, 880, 'square'), 0.002, 0.03), 0, 0.4);
    add(out, envAD(tone(0.14, 1320, 1320, 'square'), 0.002, 0.05), 0.09, 0.4);
    return norm(bq(out, 'lp', 4000), 0.6);
  })(),
]);

def('vend_clunk', 32000, () => [
  (() => {
    const out = arr(1.1);
    add(out, envAD(tone(0.4, 95, 45), 0.002, 0.08), 0, 1);
    const imp = envAD(noise(0.02), 0.0005, 0.004);
    for (const [f, t60, a] of [[820, 0.5, 0.5], [1370, 0.35, 0.35], [2240, 0.25, 0.25], [3150, 0.18, 0.15]]) add(out, resonate(imp, f, t60, a, 0.7), 0.004, 1);
    add(out, envAD(bq(noise(0.2), 'lp', 900), 0.001, 0.05), 0, 0.5);
    // the can rattles to a stop in the tray
    for (let k = 0; k < 5; k++) add(out, envAD(bq(noise(0.03), 'bp', 2600 + k * 150, 2), 0.001, 0.008), 0.32 + k * 0.09 * (1 - k * 0.12), 0.22 * (1 - k * 0.15));
    return norm(out, 0.85);
  })(),
]);

def('eat_doner', 32000, () => [
  (() => {
    const out = arr(1.3);
    for (const t of [0, 0.28, 0.55, 0.86]) {
      const bite = bq(noise(0.16), 'bp', 1700 + R() * 600, 1.2);
      for (let i = 0; i < bite.length; i++) bite[i] *= R() < 0.08 ? 3 : 0.6; // crunchy grains
      add(out, envAD(bite, 0.003, 0.05), t, 0.8);
      add(out, envAD(tone(0.12, 140, 110), 0.01, 0.05), t + 0.05, 0.25);
    }
    return norm(out, 0.75);
  })(),
]);

// Kaan's PlayStation: a cheerful chiptune loop, 125 BPM, 4 bars (exactly 7.68 s, so it loops clean).
def('ps_music', 32000, () => [
  (() => {
    const step = 60 / 125 / 2; // eighth notes
    const out = arr(step * 32);
    const C5 = 523.25;
    const mel = [0, 4, 7, 12, 7, 4, 0, null, 2, 5, 9, 14, 9, 5, 2, null, 4, 7, 11, 16, 11, 7, 4, null, 7, 4, 2, 0, 2, 4, null, null];
    mel.forEach((n, i) => {
      if (n === null) return;
      const f = C5 * Math.pow(2, n / 12);
      add(out, envShape(tone(step * 0.9, f, f, 'square'), (u) => Math.min(1, u * 40) * (1 - u * 0.6)), i * step, 0.22);
    });
    const bass = [130.81, 174.61, 196.0, 130.81];
    bass.forEach((f, bar) => {
      for (let q = 0; q < 4; q++) add(out, envShape(tone(step * 1.8, f / 2, f / 2, 'tri'), (u) => Math.min(1, u * 30) * (1 - u)), (bar * 8 + q * 2) * step, 0.45);
    });
    for (let i = 0; i < 32; i++) {
      if (i % 4 === 0) add(out, envAD(tone(0.12, 140, 45), 0.001, 0.04), i * step, 0.7); // kick
      if (i % 8 === 4) add(out, envAD(bq(noise(0.12), 'bp', 2200, 0.8), 0.001, 0.035), i * step, 0.45); // snare
      add(out, envAD(bq(noise(0.03), 'hp', 7000), 0.0005, 0.008), i * step, 0.18); // hat
    }
    return norm(out, 0.7);
  })(),
]);

// The songs for SCHOOLNET broadcasts (SONGS below): old public-domain tunes on a slightly warped music
// box, slow and in a minor key. melody: [semitones from root, beats]. 20–30 s each.
function musicBox(root, bpm, melody) {
  const beat = 60 / bpm;
  const total = melody.reduce((a, n) => a + n[1], 0) * beat;
  const out = arr(total + 2.5);
  const partials = [[1, 1, 2.6], [2, 0.28, 1.2], [3.9, 0.12, 0.5], [5.4, 0.06, 0.25]];
  let t = 0;
  for (const [n, b] of melody) {
    const warp = 1 + 0.011 * Math.sin(TAU * 0.23 * t) + (R() - 0.5) * 0.004; // a tired spring
    const f = root * Math.pow(2, n / 12) * warp;
    bellNote(out, t, f, 0.5, partials);
    bellNote(out, t + 0.004, f * 1.004, 0.18, partials); // a second, slightly out-of-tune tine
    t += b * beat * (1 + 0.02 * Math.sin(TAU * 0.11 * t)); // and it drags now and then
  }
  return norm(out, 0.8);
}
const twice = (notes) => notes.concat(notes);

// Frère Jacques ("morning bells are ringing… ding, dang, dong") in D minor, the funeral-march way. ~27 s.
def('pa_song', 32000, () => [
  musicBox(587.33, 72, [
    ...twice([[0, 1], [2, 1], [3, 1], [0, 1]]),
    ...twice([[3, 1], [5, 1], [7, 2]]),
    ...twice([[7, 0.5], [8, 0.5], [7, 0.5], [5, 0.5], [3, 1], [0, 1]]),
    ...twice([[0, 1], [-5, 1], [0, 2]]),
  ]),
]);

// Twinkle, Twinkle, Little Star, in D minor. ~30 s.
def('pa_song_twinkle', 32000, () => {
  const a = [[0, 1], [0, 1], [7, 1], [7, 1], [8, 1], [8, 1], [7, 2], [5, 1], [5, 1], [3, 1], [3, 1], [2, 1], [2, 1], [0, 2]];
  const b = [[7, 1], [7, 1], [5, 1], [5, 1], [3, 1], [3, 1], [2, 2]];
  return [musicBox(587.33, 96, [...a, ...b, ...b, ...a])];
});

// Happy Birthday, in D minor and very slowly. ~28 s.
def('pa_song_birthday', 32000, () => [
  musicBox(587.33, 56, [
    [-5, 0.75], [-5, 0.25], [-4, 1], [-5, 1], [0, 1], [-1, 2],
    [-5, 0.75], [-5, 0.25], [-4, 1], [-5, 1], [2, 1], [0, 2],
    [-5, 0.75], [-5, 0.25], [7, 1], [3, 1], [0, 1], [-1, 1], [-4, 2],
    [5, 0.75], [5, 0.25], [3, 1], [0, 1], [2, 1], [0, 3],
  ]),
]);

// Für Elise, the opening, twice (A minor; a beat is a quaver). ~30 s.
def('pa_song_elise', 32000, () => {
  const turn = [[7, 0.5], [6, 0.5], [7, 0.5], [6, 0.5], [7, 0.5], [2, 0.5], [5, 0.5], [3, 0.5], [0, 1.5]];
  const a = [...turn, [-9, 0.5], [-5, 0.5], [0, 0.5], [2, 1.5], [-5, 0.5], [-1, 0.5], [2, 0.5], [3, 1.5], [-5, 0.5],
    ...turn, [-9, 0.5], [-5, 0.5], [0, 0.5], [2, 1.5], [-5, 0.5], [3, 0.5], [2, 0.5], [0, 3]];
  return [musicBox(440, 104, twice(a))];
});

// London Bridge Is Falling Down, in D minor, twice. ~34 s.
def('pa_song_bridge', 32000, () => {
  const a = [[7, 1.5], [8, 0.5], [7, 1], [5, 1], [3, 1], [5, 1], [7, 2], [2, 1], [3, 1], [5, 2], [3, 1], [5, 1], [7, 2],
    [7, 1.5], [8, 0.5], [7, 1], [5, 1], [3, 1], [5, 1], [7, 2], [2, 2], [7, 2], [3, 1], [0, 3]];
  return [musicBox(587.33, 120, twice(a))];
});

// A distant announcement nobody can quite make out (used when announcement_caretaker.mp3 is absent):
// a voice-like pulse train through changing vowel formants, in syllables and words.
def('pa_babble', 22050, () => [
  (() => {
    const VOW = [[730, 1090], [530, 1840], [270, 2290], [570, 840], [300, 870], [660, 1720]];
    const words = [[3, 2, 2], [2, 3], [3, 1, 2, 2], [2, 2]]; // syllables per word, per phrase
    const out = arr(5.2);
    let t = 0.1;
    words.forEach((phrase, pi) => {
      phrase.forEach((syl, wi) => {
        for (let k = 0; k < syl; k++) {
          const d = 0.12 + R() * 0.1;
          const n = N(d);
          const src = new Float32Array(n);
          let ph = 0;
          const f0 = (175 - 25 * (wi / phrase.length) - (pi % 2) * 15) * (1 + (R() - 0.5) * 0.08);
          for (let i = 0; i < n; i++) {
            ph += f0 / SR;
            if (ph >= 1) ph -= 1;
            src[i] = (1 - 2 * ph) * 0.6 + (R() * 2 - 1) * 0.08;
          }
          const v = VOW[(R() * VOW.length) | 0];
          const a = bq(src.slice(), 'bp', v[0], 5);
          const b = bq(src.slice(), 'bp', v[1], 7);
          for (let i = 0; i < n; i++) a[i] = (a[i] + b[i] * 0.6) * Math.sin((Math.PI * i) / n);
          add(out, a, t, 1);
          if (R() < 0.6) add(out, envAD(bq(noise(0.04), 'bp', 3200, 1.5), 0.002, 0.01), t - 0.02, 0.25); // a consonant
          t += d + 0.015;
        }
        t += 0.07 + R() * 0.06;
      });
      t += 0.35;
    });
    return norm(out, 0.8);
  })(),
]);

// --- music building blocks ---
def('m_plink', 32000, () => [
  (() => {
    const out = arr(3);
    bellNote(out, 0, 440, 1, [[1, 1, 2.5], [2, 0.35, 1.2], [3, 0.12, 0.6], [4.2, 0.05, 0.3]], 0.006);
    bq(out, 'lp', 2500);
    return norm(out, 0.8);
  })(),
]);
def('m_tick', 32000, () => [
  (() => {
    const out = arr(0.08);
    click(out, 0, 1, 3500, 0.003);
    add(out, resonate(noise(0.003), 1800, 0.03, 1, 0.06), 0, 0.6);
    return norm(out, 0.7);
  })(),
]);
def('m_kick', 32000, () => [
  (() => {
    const out = arr(0.45);
    const s = tone(0.45, 110, 42, 'sine', 0.03);
    envAD(s, 0.001, 0.18);
    add(out, s);
    click(out, 0, 0.3, 2000, 0.002);
    softclip(out, 1.5);
    return norm(out, 0.9);
  })(),
]);
def('m_hit', 32000, () => [
  (() => {
    const out = arr(0.4);
    burst(out, 0, 1, 0.35, 0.001, 0.09, 'bp', 1800, 0.7);
    thump(out, 0, 0.6, 190, 160, 0.05, 0.2);
    add(out, modal(noise(0.005), [[540, 1, 0.12], [1270, 0.6, 0.1]], 0.3), 0, 0.8);
    softclip(out, 1.3);
    return norm(out, 0.85);
  })(),
]);
def('m_tom', 32000, () => [
  (() => {
    const out = arr(0.5);
    thump(out, 0, 1, 140, 95, 0.15, 0.5);
    burst(out, 0, 0.4, 0.1, 0.001, 0.03, 'lp', 600);
    return norm(out, 0.85);
  })(),
]);
def('m_hat', 32000, () => [
  (() => {
    const out = arr(0.08);
    burst(out, 0, 1, 0.08, 0.0005, 0.02, 'hp', 7000);
    return norm(out, 0.6);
  })(),
]);
def('m_stab', 32000, () => [
  (() => {
    const out = arr(1.4);
    add(out, modal(noise(0.015), [[233, 1, 0.7], [377, 0.8, 0.6], [610, 0.6, 0.5], [987, 0.4, 0.4]], 1.4), 0, 1.5);
    for (const f of [146.8, 155.6, 220]) {
      const s = saw(1.2, f);
      envAD(s, 0.005, 0.4);
      add(out, s, 0, 0.3);
    }
    bq(out, 'lp', 3000);
    softclip(norm(out, 1), 1.5);
    return norm(out, 0.85);
  })(),
]);
def('m_bass', 32000, () => [
  (() => {
    const s = saw(0.3, 55);
    bq(s, 'lp', 1200, 1.2, 200);
    envAD(s, 0.005, 0.15);
    return norm(s, 0.85);
  })(),
]);
def('m_farbell', 22050, () => [
  (() => {
    const out = arr(6);
    bellNote(out, 0, 523, 1, [[1, 1, 5], [2.32, 0.5, 3], [4.25, 0.3, 1.5], [6.63, 0.15, 0.8]], 0.004);
    bq(out, 'lp', 1800);
    return norm(out, 0.8);
  })(),
]);

// ---------------------------------------------------------------------------------------------
// Sound table: id → playback metadata.
//   key: procedural buffer key (default = id); bus: 'sfx'|'amb'|'music'|'voice'|'pa'|'ui'
//   gain: base gain; wet: reverb send; ref/roll: panner distances
// ---------------------------------------------------------------------------------------------
const SOUNDS = {
  footstep: { bus: 'sfx', gain: 0.55, wet: 0.1 },
  enemy_step: { bus: 'sfx', gain: 1.0, wet: 0.35, ref: 2, roll: 1.0 },
  keys_jingle: { bus: 'sfx', gain: 0.5, wet: 0.3, ref: 1.5 },
  door_open: { bus: 'sfx', gain: 1.0, wet: 0.3 },
  door_close: { bus: 'sfx', gain: 0.9, wet: 0.35 },
  door_creak: { bus: 'sfx', gain: 0.45, wet: 0.35 },
  door_locked: { bus: 'sfx', gain: 0.8, wet: 0.25 },
  locker_open: { bus: 'sfx', gain: 0.7, wet: 0.25 },
  locker_close: { bus: 'sfx', gain: 0.8, wet: 0.25 },
  cloth: { bus: 'sfx', gain: 0.5, wet: 0.08 },
  pickup: { bus: 'sfx', gain: 0.6, wet: 0.45 },
  flashlight_click: { bus: 'sfx', gain: 0.45, wet: 0.02 },
  buzz: { bus: 'amb', gain: 0.16, wet: 0 },
  fuse_crackle: { bus: 'sfx', gain: 0.55, wet: 0 },
  key_clack: { bus: 'sfx', gain: 0.45, wet: 0.05, ref: 1 },
  crt_on: { bus: 'sfx', gain: 0.5, wet: 0.1, ref: 1.2 },
  crt_off: { bus: 'sfx', gain: 0.45, wet: 0.1, ref: 1.2 },
  sn_error: { bus: 'sfx', gain: 0.55, wet: 0.15, ref: 1.5 },
  sn_ok: { bus: 'sfx', gain: 0.4, wet: 0.1, ref: 1.2 },
  vend_clunk: { bus: 'sfx', gain: 1.0, wet: 0.35, ref: 2 },
  eat_doner: { bus: 'sfx', gain: 0.8, wet: 0.05 },
  ps_music: { bus: 'sfx', gain: 0.75, wet: 0.25 },
  pa_song: { bus: 'sfx', gain: 0.8, wet: 0 },
  pa_babble: { bus: 'sfx', gain: 0.8, wet: 0 },
  roomtone: { bus: 'amb', gain: 0.26, wet: 0 },
  bang_distant: { bus: 'amb', gain: 1.0, wet: 0.75, ref: 3, roll: 1.0 },
  flicker: { bus: 'sfx', gain: 0.4, wet: 0.2 },
  bell: { bus: 'sfx', gain: 0.6, wet: 0.6 },
  pa_chime: { bus: 'pa', gain: 0.55, wet: 0 },
  pa_static: { bus: 'pa', gain: 0.3, wet: 0 },
  exit_denied: { bus: 'sfx', gain: 0.9, wet: 0.3 },
  exit_unlock: { bus: 'sfx', gain: 0.9, wet: 0.3 },
  escape: { bus: 'sfx', gain: 0.9, wet: 0.35 },
  capture_sting: { bus: 'sfx', gain: 1.0, wet: 0.3 },
  transform: { bus: 'sfx', gain: 0.9, wet: 0.4 },
  transform_warning: { bus: 'sfx', gain: 0.8, wet: 0.35 },
  victory: { bus: 'music', gain: 0.9, wet: 0.45 },
  defeat: { bus: 'music', gain: 0.9, wet: 0.4 },
  spotted: { bus: 'music', gain: 0.8, wet: 0.35 },
  room000: { bus: 'sfx', gain: 0.9, wet: 0.6, ref: 6, roll: 0.8 },
  heartbeat: { bus: 'sfx', gain: 0.7, wet: 0 },
  breath: { bus: 'sfx', gain: 0.45, wet: 0.03 },
  breath_exhausted: { bus: 'sfx', gain: 0.5, wet: 0.03 },
  exhale: { bus: 'sfx', gain: 0.45, wet: 0.03 },
  ui_hover: { bus: 'ui', gain: 0.25, wet: 0 },
  ui_select: { bus: 'ui', gain: 0.5, wet: 0 },
  ui_back: { bus: 'ui', gain: 0.45, wet: 0 },
  ui_toggle: { bus: 'ui', gain: 0.4, wet: 0 },
  announcement_intro: { bus: 'pa', gain: 1, voice: 'pa' },
  announcement_room000: { bus: 'pa', gain: 1, voice: 'pa' },
  announcement_late: { bus: 'pa', gain: 1, voice: 'pa' },
  announcement_shift: { bus: 'pa', gain: 1, voice: 'pa' },
  caretaker_still_here: { bus: 'voice', gain: 1, wet: 0.4, ref: 2, voice: 'enemy', line: 'still_here' },
  caretaker_corridor: { bus: 'voice', gain: 1, wet: 0.4, ref: 2, voice: 'enemy', line: 'corridor' },
  caretaker_school_closed: { bus: 'voice', gain: 1, wet: 0.4, ref: 2, voice: 'enemy', line: 'school_closed' },
  caretaker_found_you: { bus: 'voice', gain: 1, wet: 0.35, ref: 2, voice: 'enemy', line: 'found_you' },
  caretaker_hum: { bus: 'voice', gain: 0.7, wet: 0.45, ref: 2, line: 'hum' },
  caretaker_burp: { bus: 'voice', gain: 0.85, wet: 0.45, ref: 2, line: 'burp' },
  caretaker_wheeze: { bus: 'voice', gain: 0.8, wet: 0.4, ref: 2, line: 'wheeze' },
  caretaker_found_hiding: { bus: 'voice', gain: 1, wet: 0.3, ref: 2, voice: 'enemy', line: 'found_hiding' },
};
export const SOUND_IDS = Object.keys(SOUNDS).filter((id) => id !== 'roomtone');

// Essential buffers rendered synchronously at unlock; everything else is rendered in idle slices.
const ESSENTIAL = [
  'ui_hover', 'ui_select', 'ui_back', 'ui_toggle', 'footstep_lino', 'footstep_tile', 'scuff',
  'door_open', 'door_close', 'door_locked', 'flashlight_click', 'pickup', 'heartbeat',
];
const MUSIC_STATES = ['none', 'menu', 'calm', 'tension', 'chase', 'victory', 'defeat'];
const MAX_VOICES = 24;
const dbToGain = (db) => Math.pow(10, db / 20);

// ---------------------------------------------------------------------------------------------
// Music layers (procedural beds; a loaded loop file replaces the procedural layer)
// ---------------------------------------------------------------------------------------------
class Layer {
  constructor(sys, name, level) {
    this.sys = sys;
    this.ctx = sys.ctx;
    this.name = name;
    this.out = this.ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(sys._musicIn);
    this.inner = this.ctx.createGain();
    this.inner.gain.value = level;
    this.inner.connect(this.out);
    this.send = this.ctx.createGain();
    this.send.gain.value = 0.6;
    this.send.connect(sys._sends.music);
    this.srcs = [];
    this.endAt = 0;
    this.next = 0;
    this.step = 0;
    this.extra = 0;
  }
  fadeTo(level, dur) {
    const t = this.ctx.currentTime;
    const g = this.out.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + Math.max(0.05, dur));
    if (level === 0) this.endAt = t + dur + 0.2;
  }
  osc(type, freq, gain, dest, detune = 0) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    o.connect(g);
    g.connect(dest || this.inner);
    o.start();
    this.srcs.push(o);
    return { o, g };
  }
  lfo(freq, depth, param) {
    const o = this.ctx.createOscillator();
    o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.value = depth;
    o.connect(g);
    g.connect(param);
    o.start();
    this.srcs.push(o);
  }
  buf(key, when, gain = 1, rate = 1, wet = 0) {
    const b = this.sys._variants(key)?.[0];
    if (!b) return;
    const s = this.ctx.createBufferSource();
    s.buffer = b;
    s.playbackRate.value = rate;
    const g = this.ctx.createGain();
    g.gain.value = gain;
    s.connect(g);
    g.connect(this.inner);
    if (wet) {
      const w = this.ctx.createGain();
      w.gain.value = wet;
      g.connect(w);
      w.connect(this.send);
    }
    s.start(when);
  }
  loop(buffer) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    s.connect(this.inner);
    s.start();
    this.srcs.push(s);
  }
  tick() {}
  kill() {
    for (const s of this.srcs) {
      try { s.stop(); } catch { /* already stopped */ }
    }
    this.srcs.length = 0;
    try { this.out.disconnect(); this.send.disconnect(); } catch { /* ignore */ }
  }
}

function makeLayer(sys, state) {
  const ctx = sys.ctx;
  const file = sys._files.get('music_' + state);
  if (file) {
    const L = new Layer(sys, state, 0.8);
    L.loop(file);
    return L;
  }
  if (state === 'calm') {
    const L = new Layer(sys, state, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 280;
    lp.Q.value = 1.5;
    const amp = ctx.createGain();
    amp.gain.value = 0.35;
    lp.connect(amp);
    amp.connect(L.inner);
    L.osc('sawtooth', 55, 0.3, lp, -7);
    L.osc('sawtooth', 55, 0.3, lp, 6);
    L.osc('sine', 82.41, 0.5, lp);
    L.osc('sine', 110, 0.15, lp, 3);
    L.lfo(0.035, 140, lp.frequency);
    L.lfo(0.07, 0.12, amp.gain);
    L.next = ctx.currentTime + 3;
    const scale = [57, 60, 64, 65, 59, 62, 69];
    L.tick = (now, ahead) => {
      if (L.next < now + ahead) {
        const m = scale[(Math.random() * scale.length) | 0];
        L.buf('m_plink', L.next, 0.22, Math.pow(2, (m - 69) / 12), 0.7);
        if (Math.random() < 0.3) L.buf('m_plink', L.next + 0.4, 0.12, Math.pow(2, (m - 69 + 7) / 12), 0.8);
        L.next += 6 + Math.random() * 8;
      }
    };
    return L;
  }
  if (state === 'tension') {
    const L = new Layer(sys, state, 0.55);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    lp.Q.value = 3;
    lp.frequency.setTargetAtTime(1500, ctx.currentTime, 18);
    const pulse = ctx.createGain();
    pulse.gain.value = 0.03;
    lp.connect(pulse);
    pulse.connect(L.inner);
    L.osc('sawtooth', 98, 0.25, lp);
    L.osc('sawtooth', 103.83, 0.25, lp);
    L.osc('sine', 49, 0.3);
    const hi = ctx.createGain();
    hi.gain.value = 0.015;
    hi.connect(L.inner);
    L.osc('sine', 1244.5, 1, hi);
    L.osc('sine', 1318.5, 1, hi);
    L.lfo(5.5, 0.01, hi.gain);
    const beat = 60 / 84;
    L.next = ctx.currentTime + 0.1;
    L.tick = (now, ahead) => {
      while (L.next < now + ahead) {
        const t = L.next;
        if (L.step % 2 === 0) {
          pulse.gain.setValueAtTime(0.03, t);
          pulse.gain.linearRampToValueAtTime(0.6, t + 0.03);
          pulse.gain.setTargetAtTime(0.05, t + 0.06, 0.18);
        }
        L.buf('m_tick', t, L.step % 2 === 0 ? 0.25 : 0.12, L.step % 2 === 0 ? 1 : 1.2);
        L.step++;
        L.next += beat / 2;
      }
    };
    return L;
  }
  if (state === 'chase') {
    const L = new Layer(sys, state, 0.48);
    L.osc('sine', 36.7, 0.25);
    const K = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0];
    const BASS = [
      [0, 0, 0, 12, 0, 0, 1, 0],
      [0, 0, 0, 12, 3, 3, 1, 1],
    ];
    const sixteenth = 60 / 150 / 4;
    L.next = ctx.currentTime + 0.05;
    L.tick = (now, ahead) => {
      while (L.next < now + ahead) {
        const t = L.next;
        const s = L.step % 16;
        const bar = Math.floor(L.step / 16);
        if (K[s]) L.buf('m_kick', t, 0.9);
        if (s === 4 || s === 12) L.buf('m_hit', t, 0.55, 1, 0.3);
        if (s % 2 === 1) L.buf('m_hat', t, s % 4 === 3 ? 0.18 : 0.1);
        if (s % 2 === 0) {
          const n = BASS[bar % 2][s / 2];
          L.buf('m_bass', t, 0.45, Math.pow(2, (5 + n) / 12));
        }
        if (s === 0 && bar % 2 === 0) L.buf('m_stab', t, 0.4, [1, 0.944, 1.059][bar % 3], 0.5);
        if (bar % 4 === 3 && s >= 12) L.buf('m_tom', t, 0.6, [1.3, 1.15, 1.0, 0.9][s - 12]);
        L.step++;
        L.next += sixteenth;
      }
    };
    return L;
  }
  if (state === 'menu') {
    const L = new Layer(sys, state, 0.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 400;
    const amp = ctx.createGain();
    amp.gain.value = 0.3;
    lp.connect(amp);
    amp.connect(L.inner);
    L.osc('sine', 49, 1, lp);
    L.osc('sine', 73.4, 0.6, lp);
    L.osc('triangle', 98, 0.15, lp, 4);
    L.lfo(0.05, 0.1, amp.gain);
    L.next = ctx.currentTime + 2;
    L.tick = (now, ahead) => {
      if (L.next < now + ahead) {
        L.buf('m_farbell', L.next, 0.25, [1, 0.89, 1.12, 0.75][(Math.random() * 4) | 0], 0.85);
        L.next += 9 + Math.random() * 9;
      }
    };
    return L;
  }
  if (state === 'victory') {
    const L = new Layer(sys, state, 0.4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1200;
    lp.connect(L.inner);
    for (const m of [48, 52, 55, 60]) {
      const { o } = L.osc('sine', midi(m), 0.12, lp);
      L.lfo(0.2 + Math.random() * 0.2, 2, o.detune);
    }
    return L;
  }
  if (state === 'defeat') {
    const L = new Layer(sys, state, 0.45);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 160;
    lp.connect(L.inner);
    L.osc('sawtooth', 41.2, 0.3, lp, -8);
    L.osc('sawtooth', 41.2, 0.3, lp, 8);
    L.lfo(0.04, 60, lp.frequency);
    return L;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// AudioSystem
// ---------------------------------------------------------------------------------------------
export class AudioSystem {
  constructor(game) {
    this.game = game || {};
    this.ctx = null;
    this._ready = false;
    this._unlockPromise = null;
    this._proc = new Map(); // key → AudioBuffer[]
    this._files = new Map(); // id → AudioBuffer
    this._voices = [];
    this._lastVariant = new Map();
    this._music = 'none';
    this._pendingMusic = null;
    this._layer = null;
    this._fading = [];
    this._autoTarget = null;
    this._gt = 0;
    this._lastChaseT = -1e9;
    this._lastTenseT = -1e9;
    this._hbT = 0;
    this._brT = 0;
    this._breathHandle = null;
    this._bangT = 20;
    this._lightT = 0;
    this._ambOn = false;
    this._amb = null;
    this._paused = false;
    this._annBusyUntil = 0;
    this._annActive = 0;
    this._static = null;
    this._timers = new Set();
    this._stepCount = 0;
    this._stepSide = 1;
    this._listenerCam = null;
    this._lp = { x: 0, y: 0, z: 0 };
    this._hrtf = false;
    this._vol = { master: 0.8, music: 0.7, sfx: 0.9, voice: 1 };
    this._idleQueue = [];
    this._unsubs = [];
    this._ttsVoice = undefined;
    this._autoSuspended = false;

    const s = this.game.settings;
    if (s) {
      this._vol = { master: s.masterVolume ?? 0.8, music: s.musicVolume ?? 0.7, sfx: s.sfxVolume ?? 0.9, voice: s.voiceVolume ?? 1, chat: s.chatVolume ?? 1 };
      this._hrtf = s.quality === 'high';
    }

    // Gesture hook: first pointerdown/keydown unlocks; later gestures resume a suspended context.
    this._onGesture = () => {
      if (!this._unlockPromise) this.unlock();
      else if (this.ctx && this.ctx.state === 'suspended' && !document.hidden) this.ctx.resume().catch(() => {});
    };
    this._onVisibility = () => {
      if (!this.ctx) return;
      try {
        if (document.hidden) {
          if (this.ctx.state === 'running') {
            this._autoSuspended = true;
            this.ctx.suspend().catch(() => {});
          }
        } else if (this._autoSuspended) {
          this._autoSuspended = false;
          this.ctx.resume().catch(() => {});
        }
      } catch { /* ignore */ }
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this._onGesture, { capture: true, passive: true });
      window.addEventListener('keydown', this._onGesture, { capture: true, passive: true });
      document.addEventListener('visibilitychange', this._onVisibility);
    }
    this._subscribe();
  }

  get unlocked() {
    return this._ready;
  }
  get musicState() {
    return this._music;
  }

  // ------------------------------------------------------------------------- unlock / graph
  unlock() {
    if (this._unlockPromise) {
      try {
        if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      } catch { /* ignore */ }
      return this._unlockPromise;
    }
    try {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) {
        this._unlockPromise = Promise.resolve(false);
        return this._unlockPromise;
      }
      this.ctx = new AC({ latencyHint: 'interactive' });
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      this._build();
      for (const k of ESSENTIAL) this._render(k);
      this._ready = true;
      // (the PA's extra songs are made when you pick one: audio.prepareSong, from SCHOOLNET)
      this._idleQueue = Object.keys(GEN).filter((k) => !this._proc.has(k) && !k.startsWith('pa_song_'));
      this._scheduleIdle();
      this._sched = setInterval(() => this._schedule(), 25);
      this._applyState(this.game.state, true);
      if (this._pendingMusic) {
        const p = this._pendingMusic;
        this._pendingMusic = null;
        this._setMusic(p);
      }
      this._unlockPromise = this._loadFiles().then(
        () => true,
        () => true,
      );
    } catch {
      this._ready = false;
      this._unlockPromise = Promise.resolve(false);
    }
    return this._unlockPromise;
  }

  _build() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const G = (v = 1) => {
      const g = ctx.createGain();
      g.gain.value = v;
      return g;
    };
    this._limiter = ctx.createDynamicsCompressor();
    this._limiter.threshold.value = -6;
    this._limiter.knee.value = 6;
    this._limiter.ratio.value = 12;
    this._limiter.attack.value = 0.003;
    this._limiter.release.value = 0.25;
    this._limiter.connect(ctx.destination);
    this.master = G(this._vol.master ** 2);
    this.master.connect(this._limiter);

    // world stage (pause duck): music + ambience + reverb return
    this._worldLP = ctx.createBiquadFilter();
    this._worldLP.type = 'lowpass';
    this._worldLP.frequency.value = 20000;
    this._worldDuck = G(1);
    this._worldLP.connect(this._worldDuck);
    this._worldDuck.connect(this.master);

    const v = this._vol;
    this._buses = {
      music: G(v.music ** 2),
      amb: G(v.sfx ** 2),
      sfx: G(v.sfx ** 2),
      voice: G(v.voice ** 2),
      ui: null,
      pa: null,
    };
    this._annDuck = G(1);
    this._chatMusic = G(1); // chatDuck()
    this._buses.music.connect(this._chatMusic);
    this._chatMusic.connect(this._annDuck);
    this._annDuck.connect(this._worldLP);
    // co-op voice chat: friends' voices, on their own volume (settings.chatVolume), straight to the master
    this.chatBus = G((v.chat ?? 1) ** 2);
    this.chatBus.connect(this.master);
    this._musicIn = this._buses.music;
    this._buses.amb.connect(this._worldLP);
    this._buses.sfx.connect(this.master);
    this._buses.voice.connect(this.master);
    this._buses.ui = this._buses.sfx;

    // reverb
    this._convolver = ctx.createConvolver();
    this._convolver.buffer = this._makeIR(3.0);
    const ret = G(0.9);
    this._convolver.connect(ret);
    ret.connect(this._worldLP);
    this._sends = {
      music: G(v.music ** 2),
      amb: G(v.sfx ** 2),
      sfx: G(v.sfx ** 2),
      voice: G(v.voice ** 2),
    };
    for (const k in this._sends) this._sends[k].connect(this._convolver);
    this._sends.ui = this._sends.sfx;

    // PA chain: highpass → lowpass → light distortion → voice bus (+ slap echo + reverb)
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 400;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3500;
    const pk = ctx.createBiquadFilter();
    pk.type = 'peaking';
    pk.frequency.value = 1800;
    pk.gain.value = 5;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    const k = 2;
    for (let i = 0; i < 1024; i++) {
      const x = (i / 1023) * 2 - 1;
      curve[i] = Math.tanh(k * x) / Math.tanh(k);
    }
    shaper.curve = curve;
    shaper.oversample = '2x';
    this._paIn = G(1);
    const drive = G(0.45); // light saturation only (a full-scale voice file stays intelligible)
    const paOut = G(1.15);
    this._paIn.connect(hp);
    hp.connect(lp);
    lp.connect(pk);
    pk.connect(drive);
    drive.connect(shaper);
    shaper.connect(paOut);
    paOut.connect(this._buses.voice);
    const slap = ctx.createDelay(0.5);
    slap.delayTime.value = 0.11;
    const fb = G(0.22);
    const slapOut = G(0.3);
    paOut.connect(slap);
    slap.connect(fb);
    fb.connect(slap);
    slap.connect(slapOut);
    slapOut.connect(this._buses.voice);
    const paSend = G(0.35);
    paOut.connect(paSend);
    paSend.connect(this._sends.voice);
    // chatDuck(): the PA (announcements, and the positional SCHOOLNET broadcasts) steps back while a
    // friend talks on voice chat
    this._paChat = G(1);
    this._paChat.connect(this._paIn);
    this._paChatSfx = G(1);
    this._paChatSfx.connect(this._buses.sfx);
    this._buses.pa = this._paChat;
    this._sends.pa = null; // PA reverb handled inside the chain
    this._t0 = t;
  }

  // Long tiled-corridor impulse response: pre-delay, discrete early reflections, bright + dark tails.
  _makeIR(sec) {
    const ctx = this.ctx;
    const sr = ctx.sampleRate;
    const n = Math.round(sec * sr);
    const ir = ctx.createBuffer(2, n, sr);
    const rnd = mulberry32(0xbe11);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      const pre = Math.round(0.012 * sr);
      const taps = [0.007, 0.013, 0.019, 0.026, 0.034, 0.043, 0.051, 0.062];
      taps.forEach((tt, i) => {
        const idx = pre + Math.round((tt + (c ? 0.0017 * (i % 3) : 0)) * sr);
        if (idx < n) d[idx] += (i % 2 ? -1 : 1) * 0.55 * Math.pow(0.82, i);
      });
      let lpState = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const w = rnd() * 2 - 1;
        lpState += (w - lpState) * 0.25;
        const bright = w * Math.exp((-6.91 * t) / 1.5) * 0.35;
        const dark = lpState * Math.exp((-6.91 * t) / sec) * 0.9;
        d[i] += (bright + dark) * Math.min(1, t / 0.02);
      }
    }
    return ir;
  }

  // ------------------------------------------------------------------------- buffers
  _render(key) {
    if (this._proc.has(key)) return this._proc.get(key);
    const g = GEN[key];
    if (!g || !this.ctx) return null;
    let out = [];
    try {
      SR = g.sr || 32000;
      R = mulberry32(hashStr(key));
      const variants = g.fn();
      out = variants.map((v) => {
        const chans = Array.isArray(v) ? v : [v];
        const ab = this.ctx.createBuffer(chans.length, chans[0].length, SR);
        chans.forEach((data, c) => {
          if (ab.copyToChannel) ab.copyToChannel(data, c);
          else ab.getChannelData(c).set(data);
        });
        return ab;
      });
    } catch {
      out = [];
    }
    this._proc.set(key, out);
    return out;
  }
  _variants(key) {
    const f = this._files.get(key);
    if (f) return [f];
    return this._proc.get(key) || this._render(key);
  }
  _scheduleIdle() {
    if (!this._idleQueue.length) return;
    const step = () => {
      if (!this.ctx) return;
      const start = performance.now();
      while (this._idleQueue.length && performance.now() - start < 12) this._render(this._idleQueue.shift());
      this._scheduleIdle();
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(step, { timeout: 200 });
    else setTimeout(step, 30);
  }
  /** Dev/test: render every procedural buffer now. */
  async prerenderAll() {
    if (!this.ctx) return false;
    for (const k of Object.keys(GEN)) this._render(k);
    this._idleQueue.length = 0;
    return true;
  }

  async _loadFiles() {
    let ids = [];
    let map = { ...SOUND_FILES };
    let probe = false;
    try {
      probe = /[?&]audioprobe\b/.test(location.search);
    } catch { /* ignore */ }
    try {
      const res = await fetch(resolveAsset(MANIFEST_PATH), { cache: 'no-cache' });
      if (res.ok) {
        const m = await res.json();
        if (m && typeof m === 'object') {
          if (m.files && typeof m.files === 'object') map = { ...map, ...m.files };
          if (Array.isArray(m.available)) ids = m.available.filter((id) => map[id]);
          if (m.probeAll) probe = true;
          // your own PA songs (see SONGS)
          if (Array.isArray(m.songs)) {
            this.customSongs = m.songs
              .filter((s) => s && typeof s.file === 'string')
              .slice(0, 12)
              .map((s, i) => ({ id: `song_${i + 1}`, title: String(s.title || s.file.split('/').pop().replace(/\.\w+$/, '')).slice(0, 48), file: s.file, custom: true }));
          }
        }
      }
    } catch { /* manifest missing → procedural only */ }
    if (probe) ids = Object.keys(map);
    for (const id of ids) await this._loadFile(id, map[id]);
    for (const s of this.customSongs || []) await this._loadFile(s.id, s.file);
  }

  /** The PA's songs: the built-in music boxes, then your own (once they have loaded). */
  get songs() {
    return [...SONGS, ...(this.customSongs || []).filter((s) => this._files.has(s.id))];
  }

  /** Makes a built-in song ready ahead of time (100–250 ms of work, so not mid-run unless asked). */
  prepareSong(id) {
    if (!this.ctx || !GEN[id] || this._proc.has(id) || this._files.has(id)) return;
    setTimeout(() => this._variants(id), 0);
  }

  songTitle(id) {
    return this.songs.find((s) => s.id === id)?.title || SONGS[0].title;
  }
  async _loadFile(id, path) {
    try {
      const res = await fetch(resolveAsset(path));
      if (!res.ok) return false;
      const data = await res.arrayBuffer();
      const buf = await this.ctx.decodeAudioData(data);
      this._files.set(id, buf);
      // hot-swap running loops that this file replaces
      if (id === 'ambience_corridor' && this._amb?.room) {
        this._amb.room.stop(1.5);
        this._amb.room = this._loop(buf, 'amb', 0.4);
      }
      if (id === 'pa_static' && this._static) {
        this._static.stop(0.3);
        this._static = this._loop(buf, 'pa', SOUNDS.pa_static.gain);
      }
      if (id.startsWith('music_') && this._music === id.slice(6)) {
        const st = this._music;
        this._music = 'none';
        this._setMusic(st, 1.5, 1.5);
      }
      return true;
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------------------------- playback
  setListener(camera) {
    this._listenerCam = camera || null;
  }

  _panner(ref = 1.5, roll = 1.1) {
    const p = this.ctx.createPanner();
    p.panningModel = this._hrtf ? 'HRTF' : 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = roll;
    p.maxDistance = 40;
    return p;
  }
  _setPos(p, x, y, z) {
    if (p.positionX) {
      p.positionX.value = x;
      p.positionY.value = y;
      p.positionZ.value = z;
    } else p.setPosition(x, y, z);
  }
  _dist(pos) {
    const dx = pos.x - this._lp.x, dy = (pos.y ?? 0) - this._lp.y, dz = pos.z - this._lp.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  play(id, opts = {}) {
    try {
      if (!this._ready || !this.ctx) return null;
      const meta = SOUNDS[id];
      if (!meta) return null;
      if (meta.voice) return this._playVoice(id, meta, opts);
      let key = id;
      if (id === 'footstep') {
        const surf = SURFACES[opts.surface] ? opts.surface : 'lino';
        key = 'footstep_' + surf;
      }
      const vars = this._variants(key);
      if (!vars || !vars.length) return null;
      let idx = (Math.random() * vars.length) | 0;
      if (vars.length > 1 && idx === this._lastVariant.get(key)) idx = (idx + 1) % vars.length;
      this._lastVariant.set(key, idx);
      let vol = opts.volume ?? 1;
      let rate = opts.rate ?? 1;
      if (id === 'footstep') {
        const sp = opts.speed || 'walk';
        vol *= sp === 'crouch' ? 0.35 : sp === 'sprint' ? 1.0 : 0.6;
        rate *= (sp === 'crouch' ? 0.93 : 1) * (0.94 + Math.random() * 0.12);
        if (sp === 'sprint' && Math.random() < 0.5) {
          const sc = this._variants('scuff');
          if (sc?.length) this._start(sc[(Math.random() * sc.length) | 0], SOUNDS.footstep, { ...opts, volume: vol * 0.35 }, 1);
        }
      } else if (id === 'enemy_step' || id === 'door_open' || id === 'door_close' || id === 'locker_close' || id === 'keys_jingle') {
        rate *= 0.95 + Math.random() * 0.1;
      }
      return this._start(vars[idx], meta, opts, rate, vol);
    } catch {
      return null;
    }
  }

  _start(buffer, meta, opts, rate = 1, vol = opts.volume ?? 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = (meta.gain ?? 1) * vol;
    src.connect(g);
    const bus = this._buses[meta.bus] || this._buses.sfx;
    let p = null;
    const pos = opts.position;
    let wet = meta.wet || 0;
    if (pos && meta.bus !== 'ui' && meta.bus !== 'pa') {
      p = this._panner(meta.ref ?? 1.5, meta.roll ?? 1.1);
      this._setPos(p, pos.x, pos.y ?? 1.2, pos.z);
      g.connect(p);
      p.connect(bus);
      wet *= Math.sqrt(Math.min(1, 8 / (this._dist(pos) + 2)));
    } else if (opts.pan && ctx.createStereoPanner) {
      p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, opts.pan));
      g.connect(p);
      p.connect(bus);
    } else {
      g.connect(bus);
    }
    let w = null;
    const send = this._sends[meta.bus];
    if (wet > 0.001 && send) {
      w = ctx.createGain();
      w.gain.value = wet;
      g.connect(w);
      w.connect(send);
    }
    const when = ctx.currentTime + Math.max(0, opts.delay || 0);
    src.start(when);
    const voice = { src, g, p, w, ended: false };
    voice.stop = (fade = 0.05) => {
      if (voice.ended) return;
      try {
        const t = ctx.currentTime;
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(g.gain.value, t);
        g.gain.linearRampToValueAtTime(0, t + fade);
        src.stop(t + fade + 0.02);
      } catch { /* ignore */ }
    };
    src.onended = () => {
      voice.ended = true;
      try {
        g.disconnect();
        p?.disconnect();
        w?.disconnect();
      } catch { /* ignore */ }
      const i = this._voices.indexOf(voice);
      if (i >= 0) this._voices.splice(i, 1);
    };
    this._voices.push(voice);
    if (this._voices.length > MAX_VOICES) {
      const old = this._voices.shift();
      old.stop(0.03);
    }
    return { stop: () => voice.stop(0.08) };
  }

  _playVoice(id, meta, opts) {
    const file = this._files.get(id);
    if (file) return this._start(file, meta, opts, opts.rate ?? 1);
    if (meta.voice === 'pa') {
      const text = opts.text || ANNOUNCEMENTS[id] || '';
      return this._speakHandle(text, { pitch: 0.5, rate: 0.85 });
    }
    const text = VOICE_LINES[meta.line] || '';
    let vol = 1;
    if (opts.position) vol = Math.max(0.15, Math.min(1, 3 / (this._dist(opts.position) + 1.5)));
    return this._speakHandle(text, { pitch: 0.2, rate: 0.75, volume: vol });
  }
  _speakHandle(text, o) {
    const ok = this.speak(text, o);
    return ok ? { stop: () => { try { window.speechSynthesis.cancel(); } catch { /* ignore */ } } } : null;
  }

  _loop(buffer, busName, gain, position = null) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(g);
    let p = null;
    const bus = this._buses[busName] || this._buses.amb;
    if (position) {
      p = this._panner(1.5, 1.4);
      this._setPos(p, position.x, position.y, position.z);
      g.connect(p);
      p.connect(bus);
    } else g.connect(bus);
    src.start(ctx.currentTime, Math.random() * buffer.duration);
    g.gain.setTargetAtTime(gain, ctx.currentTime, 0.3);
    const h = {
      src, g, p, level: gain,
      stop: (fade = 0.3) => {
        try {
          const t = ctx.currentTime;
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + fade);
          src.stop(t + fade + 0.05);
        } catch { /* ignore */ }
      },
    };
    return h;
  }

  // ------------------------------------------------------------------------- speech fallback
  speak(text, { pitch = 0.5, rate = 0.85, volume = 1 } = {}) {
    try {
      if (!this._ready || !text) return false;
      if (this.game?.settings?.voiceSynth === false) return false;
      if (typeof window === 'undefined' || !window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') return false;
      const vol = Math.min(1, volume * this._vol.voice ** 2 * this._vol.master ** 2 * 1.4);
      if (vol < 0.01) return false;
      const ss = window.speechSynthesis;
      ss.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = pitch;
      u.rate = rate;
      u.volume = vol;
      const voice = this._pickTTSVoice();
      if (voice) {
        u.voice = voice;
        u.lang = voice.lang;
      } else u.lang = 'en-GB';
      u.onerror = () => {};
      ss.speak(u);
      return true;
    } catch {
      return false;
    }
  }
  _pickTTSVoice() {
    if (this._ttsVoice) return this._ttsVoice;
    try {
      const vs = window.speechSynthesis.getVoices() || [];
      if (!vs.length) return null;
      const pref = ['Daniel', 'Arthur', 'UK English Male', 'Oliver', 'George', 'Fred', 'Ralph'];
      let v = null;
      for (const name of pref) {
        v = vs.find((x) => x.name.includes(name) && /^en/i.test(x.lang));
        if (v) break;
      }
      v = v || vs.find((x) => /en[-_]GB/i.test(x.lang)) || vs.find((x) => /^en/i.test(x.lang)) || null;
      this._ttsVoice = v;
      return v;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------------------- music
  setMusicState(state) {
    try {
      if (!MUSIC_STATES.includes(state)) return;
      if (!this._ready) {
        this._pendingMusic = state;
        return;
      }
      this._setMusic(state);
    } catch { /* ignore */ }
  }
  _setMusic(state, fadeIn, fadeOut) {
    if (!this.ctx || state === this._music) return;
    const prev = this._music;
    if (fadeIn == null) {
      fadeIn = state === 'chase' ? 0.9 : state === 'tension' ? (prev === 'chase' ? 2.5 : 1.5) : state === 'none' ? 0 : 2.5;
    }
    if (fadeOut == null) fadeOut = state === 'chase' ? 1.2 : prev === 'chase' ? 3 : state === 'none' ? 1.5 : 2.5;
    if (this._layer) {
      this._layer.fadeTo(0, fadeOut);
      this._fading.push(this._layer);
      this._layer = null;
    }
    this._music = state;
    if (state === 'none') return;
    const L = makeLayer(this, state);
    if (L) {
      L.fadeTo(1, fadeIn);
      this._layer = L;
    }
  }
  _schedule() {
    try {
      if (!this.ctx || this.ctx.state !== 'running') return;
      const now = this.ctx.currentTime;
      if (this._layer) this._layer.tick(now, 0.15);
      for (let i = this._fading.length - 1; i >= 0; i--) {
        const L = this._fading[i];
        if (now > L.endAt) {
          L.kill();
          this._fading.splice(i, 1);
        } else L.tick(now, 0.15);
      }
    } catch { /* ignore */ }
  }

  // ------------------------------------------------------------------------- volumes / state
  setVolumes({ master, music, sfx, voice, chat } = {}) {
    try {
      const v = this._vol;
      if (Number.isFinite(master)) v.master = clamp01(master);
      if (Number.isFinite(music)) v.music = clamp01(music);
      if (Number.isFinite(sfx)) v.sfx = clamp01(sfx);
      if (Number.isFinite(voice)) v.voice = clamp01(voice);
      if (Number.isFinite(chat)) v.chat = clamp01(chat);
      if (!this._ready) return;
      const t = this.ctx.currentTime;
      const set = (node, val) => node && node.gain.setTargetAtTime(val, t, 0.05);
      set(this.master, v.master ** 2);
      set(this._buses.music, v.music ** 2);
      set(this._sends.music, v.music ** 2);
      set(this._buses.sfx, v.sfx ** 2);
      set(this._sends.sfx, v.sfx ** 2);
      set(this._buses.amb, v.sfx ** 2);
      set(this._sends.amb, v.sfx ** 2);
      set(this._buses.voice, v.voice ** 2);
      set(this._sends.voice, v.voice ** 2);
      set(this.chatBus, (v.chat ?? 1) ** 2);
    } catch { /* ignore */ }
  }
  _applySettings(s) {
    if (!s) return;
    this.setVolumes({ master: s.masterVolume, music: s.musicVolume, sfx: s.sfxVolume, voice: s.voiceVolume, chat: s.chatVolume });
    const hrtf = s.quality === 'high';
    if (hrtf !== this._hrtf) {
      this._hrtf = hrtf;
      const model = hrtf ? 'HRTF' : 'equalpower';
      for (const b of this._amb?.buzz || []) if (b?.p) b.p.panningModel = model;
    }
  }

  setPaused(paused) {
    try {
      this._paused = !!paused;
      try {
        if (window.speechSynthesis) paused ? window.speechSynthesis.pause() : window.speechSynthesis.resume();
      } catch { /* ignore */ }
      if (!this._ready) return;
      const t = this.ctx.currentTime;
      this._worldLP.frequency.setTargetAtTime(paused ? 700 : 20000, t, 0.12);
      this._worldDuck.gain.setTargetAtTime(paused ? dbToGain(-8) : 1, t, 0.12);
    } catch { /* ignore */ }
  }

  _applyState(state, initial = false) {
    if (!this._ready) return;
    switch (state) {
      case 'menu':
        this._stopAmbience();
        this.setPaused(false);
        this._setMusic('menu');
        break;
      case 'intro':
        this._startAmbience();
        this._setMusic('none');
        break;
      case 'playing':
        this.setPaused(false);
        this._startAmbience();
        if (!initial) this._autoTarget = null;
        break;
      case 'paused':
        this.setPaused(true);
        break;
      case 'captured':
        this._setMusic('none');
        break;
      case 'won':
        this.setPaused(false);
        this._stopAmbience(3);
        this._setMusic('victory');
        break;
      case 'lost':
        this.setPaused(false);
        this._stopAmbience(3);
        this._setMusic('defeat');
        break;
      default:
        break;
    }
  }

  // ------------------------------------------------------------------------- ambience
  _startAmbience() {
    if (!this._ready || this._ambOn) return;
    this._ambOn = true;
    const room = this._files.get('ambience_corridor') || this._variants('roomtone')?.[0];
    const buzz = this._variants('buzz')?.[0];
    this._amb = { room: null, buzz: [], flat: null, drift: 0 };
    if (room) this._amb.room = this._loop(room, 'amb', this._files.has('ambience_corridor') ? 0.4 : SOUNDS.roomtone.gain);
    if (buzz) {
      for (let i = 0; i < 2; i++) {
        const h = this._loop(buzz, 'amb', 0, this._lp);
        h.level = 0;
        this._amb.buzz.push(h);
      }
      this._amb.flat = this._loop(buzz, 'amb', 0.04);
    }
    this._bangT = 12 + Math.random() * 18;
    this._lightT = 0;
  }
  _stopAmbience(fade = 0.5) {
    this._fuseLoop?.stop(fade);
    this._fuseLoop = null;
    if (!this._amb) {
      this._ambOn = false;
      return;
    }
    this._amb.room?.stop(fade);
    this._amb.flat?.stop(fade);
    for (const b of this._amb.buzz) b.stop(fade);
    this._amb = null;
    this._ambOn = false;
  }
  /** The fuse's crackle loop follows the fuse while it is lying somewhere (see 'fuse_crackle'). */
  _updateFuse(game) {
    const e = game?.items?.getEntry?.('fuse');
    const at = e && !e.collected ? e.position : null;
    if (!at) {
      if (this._fuseLoop) this._fuseLoop.stop(0.3);
      this._fuseLoop = null;
      return;
    }
    if (!this._fuseLoop) {
      const buf = this._variants('fuse_crackle')?.[0];
      if (!buf) return;
      this._fuseLoop = this._loop(buf, 'sfx', SOUNDS.fuse_crackle.gain, at);
    } else if (this._fuseLoop.p) {
      this._setPos(this._fuseLoop.p, at.x, at.y, at.z);
    }
  }
  _getLights(world) {
    if (!world) return null;
    try {
      if (typeof world.getLightPositions === 'function') return world.getLightPositions();
      if (Array.isArray(world.lights)) return world.lights;
    } catch { /* ignore */ }
    return null;
  }
  _updateBuzz(game) {
    const amb = this._amb;
    if (!amb || !amb.buzz.length) return;
    const t = this.ctx.currentTime;
    const lights = this._getLights(game?.world);
    let i0 = -1, i1 = -1, d0 = 1e9, d1 = 1e9;
    if (lights && lights.length) {
      for (let i = 0; i < lights.length; i++) {
        const L = lights[i];
        if (!L || L.visible === false || L.intensity === 0) continue;
        const p = L.isVector3 ? L : L.position || L;
        if (p.x === undefined) continue;
        const dx = p.x - this._lp.x, dz = p.z - this._lp.z;
        const d = dx * dx + dz * dz;
        if (d < d0) { d1 = d0; i1 = i0; d0 = d; i0 = i; }
        else if (d < d1) { d1 = d; i1 = i; }
      }
    }
    const assign = (h, idx, d2) => {
      if (idx < 0 || d2 > 144) {
        h.g.gain.setTargetAtTime(0, t, 0.5);
        return;
      }
      const L = lights[idx];
      const p = L.isVector3 ? L : L.position || L;
      this._setPos(h.p, p.x, p.y ?? 3, p.z);
      h.g.gain.setTargetAtTime(SOUNDS.buzz.gain * (0.7 + Math.random() * 0.3), t, 0.6);
    };
    if (i0 >= 0) {
      assign(amb.buzz[0], i0, d0);
      assign(amb.buzz[1], i1, d1);
      amb.flat?.g.gain.setTargetAtTime(0, t, 0.6);
    } else {
      amb.buzz[0].g.gain.setTargetAtTime(0, t, 0.5);
      amb.buzz[1].g.gain.setTargetAtTime(0, t, 0.5);
      amb.flat?.g.gain.setTargetAtTime(0.04 * (0.5 + Math.random() * 0.6), t, 0.8);
    }
  }

  // ------------------------------------------------------------------------- per-frame update
  update(dt, game = this.game) {
    if (!this._ready) return;
    try {
      game = game || this.game;
      this._updateListener(game);
      const st = game?.state;
      if (st === 'playing') {
        this._gt += dt;
        if (!this._ambOn) this._startAmbience();
        this._autoMusic(game);
        this._updateBody(dt, game);
        this._bangT -= dt;
        if (this._bangT <= 0) {
          this._bangT = 18 + Math.random() * 37;
          const a = Math.random() * TAU;
          const d = 15 + Math.random() * 15;
          this._tmpPos.x = this._lp.x + Math.cos(a) * d;
          this._tmpPos.y = 1.5 + Math.random() * 2;
          this._tmpPos.z = this._lp.z + Math.sin(a) * d;
          this.play('bang_distant', { position: this._tmpPos, volume: 0.7 + Math.random() * 0.3 });
        }
        this._lightT -= dt;
        if (this._lightT <= 0) {
          this._lightT = 1;
          this._updateBuzz(game);
        }
        this._updateFuse(game);
      } else if (st === 'menu' && this._ambOn) {
        this._stopAmbience();
      }
    } catch { /* never break the game loop */ }
  }
  _tmpPos = { x: 0, y: 0, z: 0 };

  _updateListener(game) {
    const cam = this._listenerCam || game?.camera;
    if (!cam || !cam.matrixWorld) return;
    const e = cam.matrixWorld.elements;
    const L = this.ctx.listener;
    this._lp.x = e[12];
    this._lp.y = e[13];
    this._lp.z = e[14];
    if (L.positionX) {
      L.positionX.value = e[12];
      L.positionY.value = e[13];
      L.positionZ.value = e[14];
      L.forwardX.value = -e[8];
      L.forwardY.value = -e[9];
      L.forwardZ.value = -e[10];
      L.upX.value = e[4];
      L.upY.value = e[5];
      L.upZ.value = e[6];
    } else if (L.setPosition) {
      L.setPosition(e[12], e[13], e[14]);
      L.setOrientation(-e[8], -e[9], -e[10], e[4], e[5], e[6]);
    }
  }

  _autoMusic(game) {
    const enemy = game?.enemy;
    let threat = 0;
    try {
      threat = enemy?.getThreat?.() ?? 0;
    } catch { /* ignore */ }
    const es = enemy?.state;
    const now = this._gt;
    if (es === 'CHASE' || es === 'CAPTURE') {
      this._lastChaseT = now;
      this._lastTenseT = now;
    } else if (es === 'SUSPICIOUS' || es === 'INVESTIGATE' || es === 'SEARCH' || threat > 0.35) {
      this._lastTenseT = now;
    }
    let target;
    if (now - this._lastChaseT < 4) target = 'chase';
    else if (this._autoTarget === 'chase') {
      target = 'tension'; // chase just ended: hold tension for at least 6 s from here
      this._lastTenseT = now;
    } else if (now - this._lastTenseT < 6) target = 'tension';
    else target = 'calm';
    if (target !== this._autoTarget) {
      this._autoTarget = target;
      this._setMusic(target);
    }
  }

  _updateBody(dt, game) {
    let threat = 0;
    try {
      threat = clamp01(game?.enemy?.getThreat?.() ?? 0);
    } catch { /* ignore */ }
    if (threat > 0.25) {
      this._hbT -= dt;
      if (this._hbT <= 0) {
        const k = (threat - 0.25) / 0.75;
        this._hbT = 1.1 + (0.42 - 1.1) * k;
        this.play('heartbeat', { volume: 0.3 + 0.7 * k });
      }
    } else if (this._hbT > 0.3) this._hbT = 0.3;

    const p = game?.player;
    if (!p) return;
    this._brT -= dt;
    if (p.holdingBreath) {
      if (this._brT < 0.4) this._brT = 0.4;
      return;
    }
    const exhausted = p.exhausted || (p.stamina ?? 1) < 0.25;
    if (exhausted) {
      if (this._brT <= 0) {
        this._breathHandle = this.play('breath_exhausted', { volume: 0.85 });
        this._brT = 1.55;
      }
    } else if (p.isHidden) {
      if (this._brT <= 0) {
        this._breathHandle = this.play('breath', { volume: 0.6 });
        this._brT = 3.2;
      }
    }
  }

  // ------------------------------------------------------------------------- announcements
  /** Seconds of speech for an announcement: the ElevenLabs file if loaded, else an estimate. */
  speechDuration(id, text) {
    const file = this._files.get(id);
    if (file) return file.duration;
    return Math.max(2.5, String(text || ANNOUNCEMENTS[id] || '').length * 0.07);
  }

  announce(id, text) {
    try {
      if (!this._ready) return;
      text = text || ANNOUNCEMENTS[id] || '';
      const now = performance.now();
      const delay = Math.max(0, this._annBusyUntil - now);
      const speechDur = this.speechDuration(id, text);
      this._annBusyUntil = now + delay + (1.6 + speechDur + 0.9) * 1000;
      this._later(delay, () => this._runAnnouncement(id, text, speechDur));
    } catch { /* ignore */ }
  }
  _later(ms, fn) {
    const id = setTimeout(() => {
      this._timers.delete(id);
      try { fn(); } catch { /* ignore */ }
    }, ms);
    this._timers.add(id);
  }
  _runAnnouncement(id, text, speechDur) {
    if (!this._ready) return;
    const t = this.ctx.currentTime;
    this._annActive++;
    this._annDuck.gain.setTargetAtTime(dbToGain(-10), t, 0.15);
    this.play('pa_chime');
    const st = this._variants('pa_static')?.[0];
    if (st && !this._static) this._static = this._loop(st, 'pa', SOUNDS.pa_static.gain * 0.5);
    this._later(1500, () => {
      const file = this._files.get(id);
      if (file) this._start(file, SOUNDS[id] || { bus: 'pa', gain: 1 }, {});
      else this.speak(text, { pitch: 0.5, rate: 0.85 });
    });
    this._later((1.5 + speechDur + 0.4) * 1000, () => {
      this._annActive = Math.max(0, this._annActive - 1);
      if (this._annActive === 0) {
        this._static?.stop(0.6);
        this._static = null;
        this._annDuck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
      }
    });
  }

  // ------------------------------------------------------------------------- events
  _subscribe() {
    const ev = this.game.events;
    if (!ev || typeof ev.on !== 'function') return;
    const on = (type, fn) => {
      const off = ev.on(type, (p) => {
        if (!this._ready && type !== 'settings:change' && type !== 'game:state') return;
        try { fn(p || {}); } catch { /* ignore */ }
      });
      this._unsubs.push(typeof off === 'function' ? off : () => ev.off?.(type, fn));
    };
    on('player:footstep', ({ surface, speed }) => {
      this._stepSide = -this._stepSide;
      this.play('footstep', { surface, speed, pan: this._stepSide * 0.08 });
    });
    on('enemy:footstep', ({ position, running }) => {
      this.play('enemy_step', { position, volume: running ? 1 : 0.75, rate: running ? 1.05 : 1 });
      this._stepCount++;
      if (this._stepCount % 3 === 0 || Math.random() < 0.12) {
        this.play('keys_jingle', { position, volume: running ? 0.9 : 0.6, delay: 0.05 });
      }
    });
    on('door:open', ({ door }) => {
      const position = door?.position;
      this.play('door_open', { position });
      if (Math.random() < 0.4) this.play('door_creak', { position, delay: 0.12 + Math.random() * 0.1 });
    });
    on('door:close', ({ door }) => this.play('door_close', { position: door?.position }));
    on('door:locked', ({ door }) => this.play('door_locked', { position: door?.position }));
    on('hide:enter', ({ spot }) => {
      const position = spot?.position;
      if (spot?.type === 'desk') this.play('cloth', { position });
      else {
        this.play('locker_open', { position });
        this.play('locker_close', { position, volume: 0.55, delay: 0.55 });
      }
      this._brT = 1.5;
    });
    on('hide:exit', ({ spot }) => {
      const position = spot?.exitPosition || spot?.position;
      if (spot?.type === 'desk') this.play('cloth', { position });
      else this.play('locker_open', { position });
    });
    on('item:collected', () => this.play('pickup'));
    on('player:flashlight', () => this.play('flashlight_click'));
    on('player:stamina-empty', () => {
      if (this._brT > 0.3) this._brT = 0;
    });
    on('player:breath', ({ holding }) => {
      if (holding) {
        this._breathHandle?.stop();
        this._breathHandle = null;
      } else {
        this.play('exhale', { volume: 0.8 });
        this._brT = 2.2;
      }
    });
    on('enemy:voice', ({ line, position, big }) => this._enemyVoice(line, position, big));
    on('enemy:spotted', () => {
      this.play('spotted');
      this._lastChaseT = this._gt;
      this._lastTenseT = this._gt;
      this._autoTarget = 'chase';
      this._setMusic('chase');
    });
    on('announcement', ({ id, text }) => this.announce(id, text));
    on('lights:flicker', ({ intensity = 0.5 }) => {
      this.play('flicker', { volume: 0.3 + 0.7 * clamp01(intensity) });
    });
    on('world:transform-warning', () => this.play('transform_warning'));
    on('world:room000', ({ position }) => this.play('room000', position ? { position, volume: 1 } : {}));
    on('game:state', ({ state }) => this._applyState(state));
    on('settings:change', ({ settings }) => this._applySettings(settings || this.game.settings));
  }

  /** Whether a recorded file replaced the procedural sound for this id (ui.js picks subtitles by it). */
  hasFile(id) {
    return !!this._files?.has(id);
  }

  /**
   * A SCHOOLNET broadcast: the chime, then a song (`song`: an id from `songs`; Frère Jacques by
   * default) or an announcement, out of the PA speakers at `position`. It goes through the tannoy filter, two echo taps with filtered feedback (the corridors
   * throwing it back) and a big reverb send, on a panner that carries across the whole building, so
   * it rings through the empty school from wherever you are. everywhere (co-op): not placed in the world; every
   * player hears it at the same level. Returns its length in seconds (0 = silent).
   */
  broadcast(kind, position, song, everywhere = false) {
    try {
      if (!this._ready || !this.ctx || (!position && !everywhere)) return 0;
      const ctx = this.ctx;
      const chime = this._variants('pa_chime')?.[0];
      const songId = this.songs.some((s) => s.id === song) ? song : 'pa_song';
      const id = kind === 'song' ? songId : this._files.has('announcement_caretaker') ? 'announcement_caretaker' : 'pa_babble';
      const body = this._files.get(id) || this._variants(id)?.[0];
      if (!body) return 0;
      const nodes = [];
      const keep = (n) => (nodes.push(n), n);
      const inG = keep(ctx.createGain());
      inG.gain.value = kind === 'song' ? 0.8 : 0.95;
      const hp = keep(ctx.createBiquadFilter());
      hp.type = 'highpass';
      hp.frequency.value = 380;
      const lp = keep(ctx.createBiquadFilter());
      lp.type = 'lowpass';
      lp.frequency.value = 3400;
      const pk = keep(ctx.createBiquadFilter());
      pk.type = 'peaking';
      pk.frequency.value = 1700;
      pk.gain.value = 6;
      inG.connect(hp);
      hp.connect(lp);
      lp.connect(pk);
      let pan;
      if (everywhere) {
        pan = keep(ctx.createGain()); // co-op: the whole school hears it at the same level, wherever they stand
        pan.gain.value = 0.85;
      } else {
        pan = keep(this._panner(5, 0.55));
        pan.maxDistance = 140;
        this._setPos(pan, position.x, position.y ?? 2.8, position.z);
      }
      pk.connect(pan);
      for (const [time, fb, level] of [[0.43, 0.5, 0.65], [0.71, 0.38, 0.45]]) {
        const d = keep(ctx.createDelay(2));
        d.delayTime.value = time;
        const f = keep(ctx.createBiquadFilter());
        f.type = 'lowpass';
        f.frequency.value = 2300;
        const g = keep(ctx.createGain());
        g.gain.value = fb;
        const o = keep(ctx.createGain());
        o.gain.value = level;
        pk.connect(d);
        d.connect(f);
        f.connect(g);
        g.connect(d);
        f.connect(o);
        o.connect(pan);
      }
      pan.connect(this._paChatSfx || this._buses.sfx);
      const wet = keep(ctx.createGain());
      wet.gain.value = 0.55;
      pk.connect(wet);
      wet.connect(this._sends.sfx);
      const sources = [];
      const play = (buf, at, gain = 1) => {
        const src = keep(ctx.createBufferSource());
        src.buffer = buf;
        const g = keep(ctx.createGain());
        g.gain.value = gain;
        src.connect(g);
        g.connect(inG);
        src.start(at);
        sources.push(src);
        return buf.duration;
      };
      const t0 = ctx.currentTime + 0.05;
      let t = t0;
      if (chime) t += play(chime, t, 0.8) + 0.35;
      t += play(body, t);
      const total = t - t0;
      this._bcUntil = Math.max(this._bcUntil || 0, t + 1.5); // `announcing` (echo tail included)
      const b = {
        nodes,
        stop: () => {
          for (const src of sources) try { src.stop(); } catch { /* ignore */ }
          for (const n of nodes) try { n.disconnect(); } catch { /* ignore */ }
          this._broadcasts.delete(b);
        },
      };
      this._broadcasts = this._broadcasts || new Set();
      this._broadcasts.add(b);
      const tid = setTimeout(() => {
        this._timers.delete(tid);
        b.stop();
      }, (total + 5) * 1000); // let the echo die away
      this._timers.add(tid);
      return total;
    } catch {
      return 0;
    }
  }

  /** A looping sound at a world position (Kaan's PlayStation). Returns { stop(fade) } or null. */
  playLoopAt(id, position, gain) {
    try {
      if (!this._ready || !this.ctx || !position) return null;
      const buf = this._variants(id)?.[0];
      if (!buf) return null;
      const meta = SOUNDS[id] || {};
      const h = this._loop(buf, meta.bus || 'sfx', gain ?? meta.gain ?? 0.7, position);
      this._posLoops = this._posLoops || new Set();
      this._posLoops.add(h);
      const stop = h.stop;
      h.stop = (fade) => {
        this._posLoops.delete(h);
        stop(fade);
      };
      return h;
    } catch {
      return null;
    }
  }

  _enemyVoice(line, position, big = false) {
    const fileId = 'caretaker_' + line;
    // the close-up burp (big): deeper, longer and much louder, right in your ear
    const bigOpts = big && line === 'burp' ? { rate: 0.74 + Math.random() * 0.08, volume: 1.7 } : null;
    // one recorded burp: vary its pitch a little each time so it never sounds copy-pasted
    if (this._files.has(fileId)) return this.play(fileId, { position, rate: line === 'burp' ? 0.88 + Math.random() * 0.24 : undefined, ...bigOpts });
    if (line === 'hum') return this.play('caretaker_hum', { position });
    if (line === 'burp') return this.play('caretaker_burp', { position, ...bigOpts });
    if (line === 'wheeze') return this.play('caretaker_wheeze', { position });
    if (line === 'found_hiding' && this._files.has('caretaker_found_you')) return this.play('caretaker_found_you', { position });
    const text = VOICE_LINES[line];
    if (!text) return null;
    let vol = 1;
    if (position) vol = Math.max(0.15, Math.min(1, 3 / (this._dist(position) + 1.5)));
    return this.speak(text, { pitch: 0.2, rate: 0.75, volume: vol });
  }

  // ------------------------------------------------------------------------- co-op voice chat
  /** True while an announcement or a SCHOOLNET broadcast is playing (co-op: friends' voices get louder). */
  get announcing() {
    return this._annActive > 0 || (!!this.ctx && this.ctx.currentTime < (this._bcUntil || 0));
  }

  /** While a friend is talking on voice chat the PA steps back (−9 dB) and the music (−5 dB). */
  chatDuck(on) {
    on = !!on;
    if (!this._ready || !this._paChat || on === !!this._chatDucked) return;
    this._chatDucked = on;
    const t = this.ctx.currentTime;
    const tc = on ? 0.05 : 0.4; // quick to step back, slow to come back up
    this._paChat.gain.setTargetAtTime(on ? dbToGain(-9) : 1, t, tc);
    this._paChatSfx.gain.setTargetAtTime(on ? dbToGain(-9) : 1, t, tc);
    this._chatMusic.gain.setTargetAtTime(on ? dbToGain(-5) : 1, t, tc);
  }

  // ------------------------------------------------------------------------- teardown
  stopAll() {
    try {
      for (const id of this._timers) clearTimeout(id);
      this._timers.clear();
      for (const b of [...(this._broadcasts || [])]) b.stop();
      for (const h of [...(this._posLoops || [])]) h.stop(0.1);
      this._annBusyUntil = 0;
      this._annActive = 0;
      this._bcUntil = 0;
      try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
      if (!this._ready) return;
      for (const v of [...this._voices]) v.stop(0.05);
      this._voices.length = 0;
      this._static?.stop(0.1);
      this._static = null;
      this._stopAmbience(0.2);
      if (this._layer) {
        this._layer.fadeTo(0, 0.3);
        this._fading.push(this._layer);
        this._layer = null;
      }
      this._music = 'none';
      this._autoTarget = null;
      this._lastChaseT = -1e9;
      this._lastTenseT = -1e9;
      this._annDuck.gain.setTargetAtTime(1, this.ctx.currentTime, 0.1);
      this.chatDuck(false);
      this.setPaused(false);
    } catch { /* ignore */ }
  }

  dispose() {
    this.stopAll();
    for (const off of this._unsubs) {
      try { off(); } catch { /* ignore */ }
    }
    this._unsubs.length = 0;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this._onGesture, { capture: true });
      window.removeEventListener('keydown', this._onGesture, { capture: true });
      document.removeEventListener('visibilitychange', this._onVisibility);
    }
    clearInterval(this._sched);
    try { this.ctx?.close(); } catch { /* ignore */ }
    this._ready = false;
  }

  // ------------------------------------------------------------------------- dev helpers
  debugInfo() {
    return {
      unlocked: this._ready,
      ctxState: this.ctx?.state ?? 'none',
      sampleRate: this.ctx?.sampleRate ?? 0,
      voices: this._voices.length,
      music: this._music,
      layers: (this._layer ? 1 : 0) + this._fading.length,
      ambience: this._ambOn,
      files: [...this._files.keys()],
      rendered: this._proc.size,
      pending: this._idleQueue.length,
      hrtf: this._hrtf,
    };
  }
  debugPeaks() {
    const out = {};
    for (const [k, bufs] of this._proc) {
      let p = 0;
      for (const b of bufs) for (let c = 0; c < b.numberOfChannels; c++) p = Math.max(p, peakOf(b.getChannelData(c)));
      out[k] = Math.round(p * 1000) / 1000;
    }
    return out;
  }
  debugLevel() {
    if (!this.ctx) return 0;
    if (!this._analyser) {
      this._analyser = this.ctx.createAnalyser();
      this._analyser.fftSize = 2048;
      this._limiter.connect(this._analyser);
      this._anBuf = new Float32Array(2048);
      return 0;
    }
    this._analyser.getFloatTimeDomainData(this._anBuf);
    return Math.round(peakOf(this._anBuf) * 1000) / 1000;
  }
}
