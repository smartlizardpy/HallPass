// LAST BELL — shared constants. Owned by the main agent; read-only for everyone else.
// Units: 1 unit = 1 metre. Y is up. Ground floor is y = 0.

export const CELL = 4;               // layout grid cell size (m)
export const WALL_HEIGHT = 3.2;      // floor to ceiling (m)
export const WALL_THICKNESS = 0.2;
export const DOOR_WIDTH = 1.2;       // clear opening width
export const DOOR_HEIGHT = 2.2;

export const NAV_RES = 0.5;          // navigation grid resolution (m)

export const PLAYER = {
  radius: 0.3,
  height: 1.75,
  eyeHeight: 1.6,
  crouchEyeHeight: 0.95,
  walkSpeed: 2.6,
  sprintSpeed: 4.6,
  crouchSpeed: 1.3,
  interactRange: 2.2,
};

export const ENEMY = {
  radius: 0.4,
  height: 2.65,
  walkSpeed: 1.45,
  runSpeed: 4.1,                     // slightly below player sprint; stamina makes it fair
  captureRange: 1.1,
};

export const ITEM_IDS = ['keycard', 'fuse', 'key'];
export const ITEM_NAMES = {
  keycard: 'Security Keycard',
  fuse: 'Maintenance Fuse',
  key: 'Exit Access Key',
};

export const TRANSFORM_INTERVAL = 60; // seconds between building changes

// floor2Time: extra seconds on the night's clock for the upstairs floor (Second Floor update); the clock
// is timeLimit + floor2Time from the start upstairs, timeLimit alone with ?start=floor1.
// chaseBurst: seconds the caretaker can run flat out before he tires; tiredSpeed: his run speed
// multiplier once winded (normal: 4.1 -> ~3.2 m/s, still faster than your walk, slower than your sprint)
export const DIFFICULTY = {
  easy:   { exitBonus: 120, exitRoute: true, timeLimit: 540, floor2Time: 360, enemySpeed: 0.85, hearing: 0.8, sight: 0.85, aggressionStep: 0.10, chaseBurst: 4.5, tiredSpeed: 0.72 },
  normal: { exitRoute: true, timeLimit: 420, floor2Time: 300, enemySpeed: 1.0,  hearing: 1.0, sight: 1.0,  aggressionStep: 0.15, chaseBurst: 6,   tiredSpeed: 0.78 },
  hard:   { timeLimit: 300, floor2Time: 240, enemySpeed: 1.12, hearing: 1.25, sight: 1.2, aggressionStep: 0.2,  chaseBurst: 8,   tiredSpeed: 0.86 },
};

export const QUALITY = {
  low:    { renderScale: 0.4,  maxPixelHeight: 360, lightPool: 2, shadows: false, drawDistance: 26, maxFps: 60 },
  medium: { renderScale: 0.55, maxPixelHeight: 480, lightPool: 4, shadows: false, drawDistance: 34, maxFps: 60 },
  high:   { renderScale: 0.75, maxPixelHeight: 720, lightPool: 6, shadows: true,  drawDistance: 42, maxFps: 144 },
};

export const DEFAULT_SETTINGS = {
  sensitivity: 1.0,       // 0.2 – 3.0 multiplier
  invertY: false,
  fov: 72,
  masterVolume: 0.8,
  musicVolume: 0.7,
  sfxVolume: 0.9,
  voiceVolume: 1.0,
  chatVolume: 1.0,        // co-op voice chat: your friends' voices
  micHearing: false,      // the caretaker hears your real microphone (mic-detect.js); asks for the mic
  quality: 'medium',      // 'low' | 'medium' | 'high'
  scareIntensity: 'standard', // The Halloween Shift only: 'mild' | 'standard' | 'intense' (atmosphere, never the rules)
  reducedEffects: false,  // disables VHS noise, chromatic aberration, vertex jitter, screen shake, strong flicker
  headBob: true,
  subtitles: true,
  showProximity: true,    // HUD: caretaker walking distance + what he is doing
  showObjectives: true,   // HUD: "To escape" checklist
  difficulty: 'normal',   // 'easy' | 'normal' | 'hard'
};

// the caretaker hears your microphone (mic-detect.js, settings.micHearing). Levels are dBFS after a
// voice-band filter, with echo cancellation and noise suppression on and auto gain off.
export const MIC = {
  lowHz: 200,         // voice band: ignores rumble (desk knocks, fans)…
  highHz: 3000,       // …and hiss
  quiet: -42,         // dBFS: quieter than this he never hears (a whisper)
  loud: -12,          // dBFS: a shout; the radius tops out here
  overFloor: 14,      // dB above the room's own background noise
  floorRise: 3,       // dB/s: how fast the background estimate follows a room getting louder
  minMs: 120,         // ms: a sound this long counts (a click or a cough edge doesn't)
  holdMs: 250,        // ms: gaps between syllables shorter than this don't break a sentence
  radiusMin: 4,       // m: just above a whisper
  radiusMax: 18,      // m: shouting
  curve: 2.2,         // >1: talking stays small (~6–9 m, like walking), a raised voice ~12 m, shouting 18 m
  hiddenMul: 0.6,     // inside a locker / under a desk
  every: 0.4,         // s: at most one noise event this often
};

export const SETTINGS_KEY = 'lastbell.settings.v1';

// ===================================================================================================
// Second Floor update (docs/last-bell-update/architecture.md). Owned by the lead.
// ===================================================================================================

// Walking-surface height of each floor (m). Floor 1 (index 0) is the procedural ground floor; Floor 2
// (index 1) is the fixed upstairs floor: Floor 1's 3.2 m ceiling + a 0.4 m slab.
export const FLOOR_Y = [0, 3.6];
export const FLOOR_SLAB = 0.4;
// A position's floor, from its walking-surface y: anything above this is upstairs (stairs ramp between).
export const FLOOR_SPLIT_Y = 1.8;
// Floor 2 occupies cells x 0..12, z 0..10: the smallest Floor 1 footprint, so it always sits inside it.
export const FLOOR2_SIZE = { cols: 13, rows: 11 };

// The two staircases, on the same cells on both floors (Floor 1's generator pins them; see
// map-design.md §3). cells: the 1×2 stairwell; door: the stairwell cell with the door; hall: the
// corridor cell it opens onto. A is the main stair (security shutter upstairs); B is the back stair
// (chained gate at its foot, on the ground-floor corridor side).
export const STAIRS = {
  A: { cells: [[6, 0], [6, 1]], door: [6, 1], hall: [6, 2], main: true },
  B: { cells: [[10, 9], [10, 10]], door: [10, 9], hall: [10, 8], main: false },
};
// Headroom at each stair foot: the Caretaker (ENEMY.height 2.65) can't get under it.
export const STAIR_HEADROOM = 2.3;

// The Assistant (upstairs enemy). Starting values; the AI agent tunes them.
export const ASSISTANT = {
  radius: 0.32,
  height: 1.62,
  walkSpeed: 1.35,
  runSpeed: 4.0,          // below the player's sprint (4.6): stamina and corners decide it
  captureRange: 1.0,
  attackCooldown: 1.2,    // s between lunges (also enforced for a possessing Director)
};

// Founder Easter egg: who counts as "the founder" (multiplayer.md §7).
//   'founder'                 only HallPass's founder marker (attested by HallPass)
//   'founder-or-super-admin'  …or, until that marker exists, a HallPass super_admin
export const FOUNDER_RULE = 'founder-or-super-admin';

// Text chat (multiplayer.md §4): host-enforced limits.
export const CHAT = { maxLen: 140, ratePerSec: 1, burst: 3, cooldown: 10, history: 50, dupWindow: 5 };
