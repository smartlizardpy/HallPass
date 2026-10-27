/**
 * The collectibles. The curated set (`curated.generated.ts`) carries final, full-card art; the
 * demo rows below are the launch placeholders (pixel art, public/collectibles/ART.md), kept
 * because people may own them. Replace a demo file at the same path and flip `art.status` to `final`.
 *
 * Names and captions are original, school-safe and refer to no real person or
 * brand. The Internet Culture, Brainrot and Turkish sets need a human content
 * sign-off before final art (docs/collectibles-design.md §1.7).
 *
 * NEVER delete or renumber a row: people own these. Retire with `retired: true`.
 */

import { CURATED } from "./curated.generated";
import type { ArtStatus, Collectible, CollectibleKind, CollectiblePool, Finish, Frame, Rarity } from "./types";

const FINISH: Record<Rarity, Finish> = {
  common: "standard",
  uncommon: "standard",
  rare: "foil",
  epic: "holo",
  legendary: "animated",
};

interface Extra {
  kind?: CollectibleKind;
  frame?: Frame;
  pool?: CollectiblePool;
  art?: ArtStatus;
}

/** [slug, name, rarity, caption, extras]; the id is `<collection>-<slug>`, numbered in listed order. */
type Row = [slug: string, name: string, rarity: Rarity, caption: string, extra?: Extra];

function build(collection: string, rows: Row[]): Collectible[] {
  return rows.map(([slug, name, rarity, caption, extra], i) => {
    const id = `${collection}-${slug}`;
    return {
      id,
      collection,
      number: i + 1,
      name,
      caption,
      rarity,
      kind: extra?.kind ?? (rarity === "common" || rarity === "uncommon" ? "sticker" : "card"),
      finish: FINISH[rarity],
      frame: extra?.frame ?? (collection === "ff26" ? "event" : "standard"),
      pool: extra?.pool ?? "standard",
      art: { src: `/collectibles/${collection}/${id}.png`, status: extra?.art ?? "demo", alt: `Pixel art: ${name}` },
    };
  });
}

/** The 15 demo Fright Fest cards: retired (their owners keep them) now the curated set replaces them. */
const FF26_DEMO = build("ff26", [
  ["cobweb-bell", "Cobweb Bell", "common", "Nobody has rung it in years. It still sounds nervous."],
  ["detention-slip", "Detention Slip", "common", "Signed by someone who is definitely not a teacher."],
  ["pumpkin-locker", "Pumpkin Locker", "common", "Inside: snacks and one very smug pumpkin."],
  ["arcade-bat", "Arcade Bat", "common", "Lives in the coin slot. Pays in squeaks."],
  ["yellow-moon", "Yellow Moon", "common", "The reason the corridor is a bit brighter than it should be."],
  ["room-000", "Room 000", "uncommon", "The only door with no number. Knock politely."],
  ["corridor-ghost", "Corridor Ghost", "uncommon", "Walks on the left. Always on the left."],
  ["blackout", "Blackout", "uncommon", "Every screen went dark. The high scores kept glowing."],
  ["cursed-cabinet", "Cursed Cabinet", "uncommon", "Insert one coin. Receive one very long stare."],
  ["pumpkin-soul", "Pumpkin Soul", "uncommon", "A tiny glow that hums when you beat your best."],
  ["shadow-dash", "Shadow Dash", "rare", "Gone before the afterimage catches up."],
  ["haunted-arcade", "Haunted Arcade", "rare", "Every cabinet switched on at once. Nobody touched the plug."],
  ["blood-moon", "Blood Moon", "epic", "Rises once a year. Sets when the last bell rings."],
  ["the-caretaker", "The Caretaker", "epic", "Knows every corridor. Never speaks. Always has the spare key."],
  ["the-last-bell", "The Last Bell", "legendary", "When it rings, everybody had better be heading out."],
]).map((c) => ({ ...c, retired: true as const }));

const HPO = build("hpo", [
  ["doodle-dash", "Doodle Dash", "common", "Scribbles first, asks questions later."],
  ["neon-snake", "Neon Snake", "common", "Long, glowing and extremely confident."],
  ["neon-hockey", "Neon Hockey", "common", "The puck has opinions about the walls."],
  ["pixel-slicer", "Pixel Slicer", "common", "Cuts first, counts later."],
  ["paddle-crawler", "Paddle Crawler", "common", "A dungeon, a paddle and a questionable plan."],
  ["chroma-orbit", "Chroma Orbit", "uncommon", "Match the colour, keep the orbit."],
  ["duskfall", "Duskfall", "uncommon", "The sun goes down and the score goes up."],
  ["vanta-void", "Vanta Void", "uncommon", "So dark it makes the other cards look shiny."],
  ["yellow-dot", "Yellow Dot", "rare", "Small, round and somehow everywhere."],
  ["reactor", "Reactor", "rare", "Keep it stable. Keep it warm. Do not sneeze."],
  ["sea-mercenary", "Sea Mercenary", "epic", "Hired for one voyage. Stayed for the loot."],
  ["hall-pass", "Hall Pass", "legendary", "Your ticket to anywhere. A teacher still has to sign it."],
]);

const INET = build("inet", [
  ["loading", "Loading 99%", "common", "So close. It has been so close for a while."],
  ["404", "Error 404", "common", "Ghost not found."],
  ["captcha", "Captcha", "common", "Click every picture with a bus. Does the corner count?"],
  ["mute", "Muted", "common", "You are on mute. You have been on mute."],
  ["wifi", "One Bar", "common", "Just enough signal to load half a page."],
  ["reply-all", "Reply All", "uncommon", "Oops. Now everybody knows."],
  ["cursor", "Cursor in a Hat", "uncommon", "A little arrow with a big hat."],
  ["buffer", "Buffering", "uncommon", "The wheel spins. Hope spins with it."],
  ["touch-grass", "Touch Grass", "rare", "Step one: log off. Step two: actual grass."],
  ["viral-cat", "Viral Cat", "rare", "Posted at noon. By lunch the whole school had seen it."],
  ["algorithm", "The Algorithm", "epic", "Knows what you will watch next. Rude of it."],
  ["main-character", "Main Character", "legendary", "Today's episode: you walk in. Cue the music."],
]);

const BRR = build("brr", [
  ["sigma-toaster", "Sigma Toaster", "common", "Pops up at exactly the right moment."],
  ["rizzly-bear", "Rizzly Bear", "common", "Charming in three different forests."],
  ["npc-pigeon", "NPC Pigeon", "common", "Walks the same loop. Every. Day."],
  ["skill-issue", "Skill Issue", "common", "A very slow snail with a very long excuse."],
  ["ohio-boss", "Ohio Boss", "common", "A serious cornfield with a serious briefcase."],
  ["aura-farmer", "Aura Farmer", "uncommon", "Plants good vibes, harvests them by Friday."],
  ["delulu-duck", "Delulu Duck", "uncommon", "Fully convinced the pond is a catwalk."],
  ["mewing-cat", "Mewing Cat", "uncommon", "Jawline: sharp. Whiskers: sharper."],
  ["brain-blob", "Brain Blob", "rare", "Thinks about nothing so hard it glows."],
  ["infinite-scroll", "Infinite Scroll", "rare", "There is no bottom. People have checked."],
  ["rizz-wizard", "Rizz Wizard", "epic", "Casts Smooth Hello. It is very effective."],
  ["spaghetti-wizard", "Spaghetti Wizard", "legendary", "A noodle-based spell with unlimited sauce."],
]);

const TR = build("tr", [
  ["simit", "Simit", "common", "Sesame ring. Perfect for any bus stop."],
  ["cay", "Çay", "common", "A small glass and a big conversation."],
  ["ayran", "Ayran", "common", "Cool, salty and always cold enough."],
  ["dolmus", "Dolmuş", "common", "There is always room for one more passenger."],
  ["tavla", "Tavla", "common", "Click, clack and a very dramatic dice roll."],
  ["nazar", "Nazar", "uncommon", "Keeps an eye out so you do not have to."],
  ["street-cat", "Street Cat", "uncommon", "Owns the block. Accepts snacks as tax."],
  ["teyze-radar", "Teyze Radar", "uncommon", "Spots a missing jacket from three streets away."],
  ["terlik", "Terlik", "rare", "The slipper that flies. Aim not included."],
  ["harclik", "Harçlık", "rare", "Pocket money, spent wisely, mostly on snacks."],
  ["mangal", "Mangal", "epic", "The weekend smoke signal: everyone is invited."],
  ["kisir-night", "Kısır Night", "legendary", "Everybody brings a dish. Nobody leaves hungry."],
]);

/**
 * The curated set (hallpass-card, imported by scripts/catalogue-import.mjs): the five Fright Fest
 * prize-only commemoratives keep their old ids, so packs and championship rewards are unchanged.
 * The demo sets above (hpo, inet, brr, tr) stay for the people who own them; their collections are retired.
 */
export const COLLECTIBLES: Collectible[] = [...FF26_DEMO, ...CURATED, ...HPO, ...INET, ...BRR, ...TR];
