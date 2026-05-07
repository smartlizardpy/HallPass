export type ArtStyle =
  | "speed"
  | "swarm"
  | "wave"
  | "void"
  | "rune"
  | "orbit"
  | "eye"
  | "serpent"
  | "glitch"
  | "splatter"
  | "terrain"
  | "tether"
  | "rink"
  | "slash";

export type Game = {
  slug: string;
  title: string;
  tagline: string;
  description: string;
  category: string;
  tags: string[];
  gradient: [string, string];
  accent: string;
  art: ArtStyle;
  isNew?: boolean;
  isFeatured?: boolean;
  plays?: number;
};

export const games: Game[] = [
  {
    slug: "neon-velocity-hyperdrive",
    title: "Neon Velocity: Hyperdrive",
    tagline: "Flip gravity. Outrun the grid.",
    description:
      "Endless gravity-flip runner. Pick a rig, dash through hazards, and bend time to stay alive.",
    category: "Arcade",
    tags: ["Arcade", "Neon", "Action"],
    gradient: ["#ff2bd6", "#00e5ff"],
    accent: "#ff2bd6",
    art: "speed",
    isFeatured: true,
    plays: 184213,
  },
  {
    slug: "crimson-survivor",
    title: "Crimson Survivor",
    tagline: "Outlast the red tide",
    description:
      "A relentless bullet-heaven where every second alive earns you stranger weapons.",
    category: "Survivor",
    tags: ["Survivor", "Roguelike", "Action"],
    gradient: ["#ff003c", "#7a0019"],
    accent: "#ff3559",
    art: "swarm",
    isNew: true,
    plays: 4220,
  },
  {
    slug: "sea-mercenary",
    title: "Sea Mercenary",
    tagline: "Contracts, cannons, and open water",
    description:
      "Top-down naval combat. Run contracts, swap between eight weapon types, and upgrade your hull at the Admiralty Dry Dock.",
    category: "Shooter",
    tags: ["Shooter", "Naval", "Action"],
    gradient: ["#0ea5e9", "#0f172a"],
    accent: "#22d3ee",
    art: "wave",
    plays: 28110,
  },
  {
    slug: "vanta-void",
    title: "Vanta Void",
    tagline: "Neon Overdrive",
    description:
      "Pick a ship class and blast through waves of enemies in this dark-neon arena shooter.",
    category: "Shooter",
    tags: ["Shooter", "Neon", "Action", "Roguelike"],
    gradient: ["#1f1f1f", "#5b21b6"],
    accent: "#a78bfa",
    art: "void",
    plays: 13400,
  },
  {
    slug: "depths-of-aethelgard",
    title: "Depths of Aethelgard",
    tagline: "Forgotten kingdoms below",
    description:
      "Descend a cursed floor-by-floor dungeon. Level up, unlock brutal weapons, and topple the bosses that guard each depth.",
    category: "Survivor",
    tags: ["Roguelike", "Fantasy", "Dungeon", "Action"],
    gradient: ["#92400e", "#1c1917"],
    accent: "#fbbf24",
    art: "rune",
    plays: 9012,
  },
  {
    slug: "symbiosis",
    title: "Symbiosis",
    tagline: "The Mycelium Network",
    description:
      "Grow a living forest network — explore fog, catch wisps, weather storms, and evolve.",
    category: "Simulation",
    tags: ["Simulation", "Nature", "Strategy"],
    gradient: ["#10b981", "#064e3b"],
    accent: "#34d399",
    art: "orbit",
    plays: 5680,
  },
  {
    slug: "silence",
    title: "Silence",
    tagline: "Don't make a sound",
    description:
      "A stealth horror game where the monsters listen for every footstep.",
    category: "Horror",
    tags: ["Horror", "Stealth"],
    gradient: ["#1e1b4b", "#020617"],
    accent: "#818cf8",
    art: "eye",
    plays: 22001,
  },
  {
    slug: "neon-snake",
    title: "Neon Snake",
    tagline: "The classic, electrified",
    description:
      "Slither through hazard fields collecting voltage cells in this arcade revival.",
    category: "Arcade",
    tags: ["Arcade", "Neon"],
    gradient: ["#22c55e", "#0a0a0a"],
    accent: "#4ade80",
    art: "serpent",
    plays: 96214,
  },
  {
    slug: "system-restore",
    title: "System Restore",
    tagline: "Web Evolution",
    description:
      "Start from 1991 and evolve the web — buy HTML tags, hyperlinks, and images to grow your site.",
    category: "Simulation",
    tags: ["Simulation", "Idle", "Incremental"],
    gradient: ["#0284c7", "#1e293b"],
    accent: "#38bdf8",
    art: "glitch",
    plays: 7423,
  },
  {
    slug: "neon-fracture",
    title: "Neon Fracture",
    tagline: "Reality, broken in RGB",
    description:
      "2D action platformer. Jump, double-jump, and dash through fractured neon stages wielding energy-gated weapons from miniguns to black holes.",
    category: "Shooter",
    tags: ["Shooter", "Neon", "Action", "Platformer"],
    gradient: ["#e11d48", "#7c3aed"],
    accent: "#f43f5e",
    art: "glitch",
    plays: 11244,
  },
  {
    slug: "color-clash-3d",
    title: "Color Clash 3D",
    tagline: "Neon Prime — Tactical Arcade Shooter",
    description:
      "Fast-paced tactical arena shooter with neon visuals and system upgrades.",
    category: "Shooter",
    tags: ["Shooter", "Action", "Neon", "Roguelike"],
    gradient: ["#f97316", "#db2777"],
    accent: "#fb923c",
    art: "splatter",
    plays: 88330,
  },
  {
    slug: "cube-clash-3d",
    title: "Cube Clash 3D",
    tagline: "Ultimate Arsenal — 2-player brawler",
    description:
      "Local 2-player or vs CPU arena brawler with weapon upgrades and explosive crates.",
    category: "Multiplayer",
    tags: ["Multiplayer", "Fighting", "Local Co-op"],
    gradient: ["#22d3ee", "#7c3aed"],
    accent: "#22d3ee",
    art: "splatter",
    plays: 41200,
  },
  {
    slug: "teraria",
    title: "Teraria",
    tagline: "Dig. Build. Survive.",
    description:
      "Mine, craft, and build in a 2D pixel sandbox. Stock the hotbar, fight off enemies, and take down the Eye of Doom.",
    category: "Sandbox",
    tags: ["Sandbox", "Adventure", "Crafting", "Pixel"],
    gradient: ["#16a34a", "#0c4a6e"],
    accent: "#84cc16",
    art: "terrain",
    plays: 142001,
  },
  {
    slug: "snag",
    title: "S N A G",
    tagline: "Neon ascension — 1v1 dash duel",
    description:
      "Two-player local arena duel. Dash, phase-shift, and outplay your rival across a neon battleground.",
    category: "Multiplayer",
    tags: ["Multiplayer", "Local Co-op", "Fighting", "Neon"],
    gradient: ["#facc15", "#9a3412"],
    accent: "#fde047",
    art: "tether",
    plays: 6710,
  },
  {
    slug: "neon-hockey",
    title: "Neon Hockey",
    tagline: "Air-hockey, weaponized",
    description:
      "Local matches vs CPU or hotseat, plus Tournament, Time Attack, and Zen modes. Power-ups, ramps, and laser pucks included.",
    category: "Sports",
    tags: ["Sports", "Multiplayer", "Local Co-op"],
    gradient: ["#06b6d4", "#1e40af"],
    accent: "#22d3ee",
    art: "rink",
    plays: 33421,
  },
  {
    slug: "core-vs-swarm",
    title: "Core vs. Swarm",
    tagline: "Two players, one core",
    description:
      "Asymmetric 1v1 local duel. One player rotates a shield around the core; the other spends energy summoning the swarm.",
    category: "Multiplayer",
    tags: ["Multiplayer", "Action", "Fighting"],
    gradient: ["#eab308", "#7c2d12"],
    accent: "#fde68a",
    art: "swarm",
    plays: 19120,
  },
  {
    slug: "jjk-domain-survival-v3",
    title: "JJK: Domain Survival V3",
    tagline: "Take the quiz. Claim your domain.",
    description:
      "Answer a ten-question personality quiz to be assigned your sorcerer, then survive waves in a CRT-styled cursed arena with an expanded roster.",
    category: "Survivor",
    tags: ["Anime", "Survivor", "Action"],
    gradient: ["#7e22ce", "#020617"],
    accent: "#c084fc",
    art: "rune",
    plays: 211405,
  },
  {
    slug: "jjk-domain-survival-top-down",
    title: "JJK: Domain Survival — Top Down",
    tagline: "Cursed energy, new angle",
    description:
      "A top-down reinterpretation of the cursed survival arena with all-new abilities.",
    category: "Survivor",
    tags: ["Anime", "Survivor", "Action"],
    gradient: ["#a21caf", "#0f172a"],
    accent: "#e879f9",
    art: "orbit",
    plays: 89532,
  },
  {
    slug: "neon-tether",
    title: "Neon Tether",
    tagline: "Swing the flail. Protect the core.",
    description:
      "Pilot your core and whip a physics-tethered flail through waves of enemies. Swing fast enough and it goes white-hot, one-shotting brutes.",
    category: "Arcade",
    tags: ["Arcade", "Action", "Physics"],
    gradient: ["#6366f1", "#0f172a"],
    accent: "#a5b4fc",
    art: "tether",
    plays: 4221,
  },
  {
    slug: "chroma-orbit",
    title: "Chroma Orbit",
    tagline: "Ultimate Edition — color-swap shooter",
    description:
      "Fire weapons, swap colors, and hyper-dash through waves of enemies in orbit.",
    category: "Shooter",
    tags: ["Shooter", "Action", "Colorful"],
    gradient: ["#ec4899", "#0ea5e9"],
    accent: "#f472b6",
    art: "orbit",
    plays: 16800,
  },
  {
    slug: "pixel-slicer",
    title: "Pixel Slicer",
    tagline: "Swipe to slice",
    description:
      "Swipe through waves of pixel enemies — fast, simple, and satisfying.",
    category: "Arcade",
    tags: ["Arcade", "Action", "Casual"],
    gradient: ["#f59e0b", "#1f2937"],
    accent: "#fbbf24",
    art: "slash",
    plays: 54021,
  },
  {
    slug: "pixel-bullet-quest",
    title: "Pixel Bullet Quest",
    tagline: "Every weapon is unique",
    description:
      "Delve pixel chambers, loot tiered weapons with wild traits, dodge-roll past swarms, and topple a boss every fifth floor.",
    category: "Shooter",
    tags: ["Shooter", "Roguelike", "Pixel", "Dungeon"],
    gradient: ["#fcd34d", "#0f0f1b"],
    accent: "#facc15",
    art: "swarm",
    isNew: true,
    plays: 0,
  },
  {
    slug: "system-error",
    title: "System.ERROR",
    tagline: "Overdrive Protocol",
    description:
      "WASD shooter with mouse-aim and quantum dash. Glitch the system before it glitches you.",
    category: "Shooter",
    tags: ["Shooter", "Cyber", "Action", "Neon"],
    gradient: ["#ef4444", "#0c0a09"],
    accent: "#f87171",
    art: "glitch",
    plays: 28722,
  },
  {
    slug: "nuclear-reactor-manager",
    title: "Nuclear Reactor Manager",
    tagline: "Don't let it melt down",
    description:
      "Run a CRT-styled reactor: balance control rods, coolant, and load before the core goes critical.",
    category: "Simulation",
    tags: ["Simulation", "Retro", "Strategy"],
    gradient: ["#33ff33", "#050505"],
    accent: "#33ff33",
    art: "glitch",
    isNew: true,
  },
];

export const categories = Array.from(
  new Set(games.map((g) => g.category))
).sort();

export const allTags = Array.from(
  new Set(games.flatMap((g) => g.tags))
).sort();

export function findGame(slug: string) {
  return games.find((g) => g.slug === slug);
}
