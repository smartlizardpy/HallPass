import type { Collection } from "./types";

export const COLLECTIONS: Collection[] = [
  {
    id: "ff26",
    name: "Fright Fest 2026",
    description: "The haunted-arcade set from the first HallPass Fright Fest. Earned by playing, kept forever.",
    kind: "event",
    theme: { colours: ["#14091f", "#ffd84a", "#ff7a1a"], wrapper: "prize-bag" },
    availableFrom: "2026-10-28",
    availableUntil: "2026-11-01",
    sort: 1,
  },
  {
    id: "hpo",
    name: "HallPass Originals",
    description: "Stickers and cards for the games we made ourselves.",
    kind: "permanent",
    theme: { colours: ["#1b2a4a", "#ffd84a", "#f2e8d5"], wrapper: "hall-pass-tag" },
    sort: 2,
  },
  {
    id: "inet",
    name: "Internet Culture",
    description: "Loading wheels, error pages and other things everybody has met online.",
    kind: "permanent",
    theme: { colours: ["#1f3b73", "#7fd1ff", "#ffffff"], wrapper: "browser-sleeve" },
    sort: 3,
  },
  {
    id: "brr",
    name: "Brainrot",
    description: "Original characters for the silliest corner of the corridor. Nothing here is a real person or a real meme.",
    kind: "permanent",
    theme: { colours: ["#ff4fd8", "#7fd16a", "#ffd84a"], wrapper: "snack-sachet" },
    sort: 4,
  },
  {
    id: "tr",
    name: "Turkish Internet Culture",
    description: "Everyday scenes and snacks from Turkish life, drawn as original pixel stickers.",
    kind: "permanent",
    theme: { colours: ["#c81e3a", "#f2e8d5", "#1f3b73"], wrapper: "tea-box" },
    sort: 5,
  },
];
