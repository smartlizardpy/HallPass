import type { Game } from "@/app/lib/games";

/**
 * HallPass — the questions a game's store page answers, and their answers.
 *
 * ── WHY THIS IS GENERATED AND NOT WRITTEN ──────────────────────────────────
 * Thirty hand-written answer sets is thirty chances to assert something that is
 * not true of that game, and the answers here are ones people act on: whether it
 * costs money, whether it needs a keyboard, whether it will work at school.
 * Every answer below is derived from a fact the catalogue already asserts, so it
 * cannot drift from the game it describes — change `platform` in the dashboard
 * and the phone answer changes with it.
 *
 * ── THE ANSWERS ARE RENDERED ON THE PAGE ───────────────────────────────────
 * `FAQPage` markup is only allowed to describe content a visitor can actually
 * read, so `GameStore` renders these and `app/game/[slug]/page.tsx` marks up the
 * same array. Emitting markup for text nobody can see is how a domain earns a
 * structured-data manual action — the same reason that page carries no
 * `aggregateRating` and no invented `uploadDate`. Never emit from here without
 * rendering from here.
 *
 * ── A QUESTION WITH NO HONEST ANSWER IS OMITTED ────────────────────────────
 * `platform` is a three-value capability whose ABSENT case is load-bearing (see
 * `GamePlatform`): "we have not checked" is a real state, and it is why that
 * field is not a boolean. A game in it gets no phone question rather than a
 * guess dressed as an answer.
 *
 * PURE, and deliberately free of `server-only`: the page marks these up on the
 * server and `GameStore` renders them in the browser, so both sides need it.
 */

export type FaqEntry = { question: string; answer: string };

/**
 * Whether this game keeps working with no network.
 *
 * The service worker precaches every file of every LOCAL game, which is the most
 * unusual true thing this site can say. It is NOT true of an external game: that
 * one is an iframe onto somebody else's origin, which no service worker of ours
 * can precache. Saying it anyway would be the one answer here that a player
 * could catch us out on, in the exact situation — no network — where they most
 * needed it to be true.
 */
function playsOffline(game: Game): boolean {
  return !game.externalUrl;
}

/** The phone answer, or `null` when the catalogue has not recorded one. */
function phoneAnswer(game: Game): string | null {
  switch (game.platform) {
    case "both":
      return `Yes. ${game.title} works on a phone or tablet as well as on a laptop.`;
    case "mobile":
      return `Yes — ${game.title} is made for touch, so a phone or tablet is the best way to play it.`;
    case "desktop":
      return `No. ${game.title} needs a keyboard and mouse, so play it on a laptop or desktop.`;
    default:
      return null;
  }
}

/**
 * The FAQ for one game, in the order it renders. Never empty: the first, third
 * and fourth entries hold for every game in the catalogue.
 */
export function gameFaq(game: Game): FaqEntry[] {
  const entries: FaqEntry[] = [
    {
      question: `Is ${game.title} free to play?`,
      answer: `Yes. ${game.title} is free, and so is everything else on HALLPASS. There is nothing to pay for and no account is needed to play — signing in only adds scores, streaks and friends.`,
    },
  ];

  const phone = phoneAnswer(game);
  if (phone) {
    entries.push({ question: `Does ${game.title} work on a phone?`, answer: phone });
  }

  entries.push({
    question: `Do I need to download anything to play ${game.title}?`,
    answer: `No. ${game.title} runs in your browser — press Play and it opens on this page. HALLPASS can also be installed from your browser's menu, which puts it on your home screen, but that is optional.`,
  });

  entries.push({
    question: `Can I play ${game.title} at school?`,
    answer: playsOffline(game)
      ? `HALLPASS is built for school laptops: it loads like any other website, and once you have opened it once the whole arcade — ${game.title} included — keeps working even when the network drops. Whether it opens in the first place depends on your school's own filter, which is not something we control.`
      : `HALLPASS is built for school laptops and loads like any other website. ${game.title} is hosted elsewhere and opens in a frame on this page, so it needs a working connection, and whether it opens depends on your school's own filter — which is not something we control.`,
  });

  return entries;
}
