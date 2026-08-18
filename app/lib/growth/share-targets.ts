/**
 * HallPass — WEB SHARE INTENTS for the marketing link builder.
 *
 * A share intent is a plain URL that opens someone else's composer with our
 * link already in it: `https://wa.me/?text=…` opens WhatsApp with the message
 * typed. No SDK, no script tag, no third-party JavaScript on the page — which
 * is the only reason this is allowed to exist at all, since `marketing-design.md`
 * §2 rules out third-party pixels and their tracking with them.
 *
 * WHY THIS BEATS COPY-AND-PASTE, given the builder already hands over the URL:
 * the ref goes with it. A person copying a link and pasting it into WhatsApp
 * has to have remembered to set the channel picker to WhatsApp first, and when
 * they forget — they will — the visit reports as whatever channel happened to
 * be selected. {@link shareHref} makes that impossible: the tag is derived from
 * the button, so pressing "WhatsApp" cannot produce a link tagged `tiktok`.
 *
 * ── WHAT IS DELIBERATELY MISSING ───────────────────────────────────────────
 * These are channels in `channels.ts` with no button here, and each absence is
 * a decision rather than an oversight:
 *
 * - **Snapchat.** Two mutually exclusive formats are in circulation
 *   (`snapchat.com/scan?attachmentUrl=` and `snapchat.com/share?link=`) and
 *   Snap's developer documentation could not be read from this network to
 *   settle it. A button that silently opens the wrong page is worse than no
 *   button, so Snapchat stays a copy-the-link channel until someone can check.
 * - **Instagram and Discord.** Neither publishes a web composer URL. Instagram
 *   accepts links only in a bio, a story sticker or a DM typed by hand.
 * - **Texts / iMessage.** `sms:?body=` (RFC 5724) is real and works on a
 *   phone, and does nothing at all in a desktop browser — which is where this
 *   admin page is used. The native share sheet in the builder covers it on the
 *   devices where it means something.
 *
 * The native share sheet itself is NOT here: `navigator.share` is a browser API
 * rather than a URL, it needs a user gesture, and it cannot know which app the
 * person will pick. The builder calls it directly and tags with whatever the
 * channel picker says — the one case where the human, not the button, decides
 * what the link claims to be.
 *
 * Pure, dependency-free apart from the tagger, so it unit tests in the plain
 * `node` environment.
 */

import { taggedUrl } from "./channels";

/** What gets shared: an already-tagged link, and the words around it. */
export type ShareMessage = {
  /** Absolute, `ref`-tagged URL. */
  url: string;
  /** One line of human text. Composers show it above or beside the link. */
  text: string;
};

export type ShareTarget = {
  /**
   * The `ref` this target tags with. MUST be an id in `CHANNELS` — a target
   * naming a channel we do not publish would report every share it produced as
   * an unknown ref. `share-targets.test.ts` enforces it.
   */
  channel: string;
  /** Button text. */
  label: string;
  /** The composer URL. */
  href: (message: ShareMessage) => string;
};

/**
 * URL-encode for a query string.
 *
 * `encodeURIComponent` rather than `URLSearchParams`, which writes a space as
 * `+`. That is correct for a query string and wrong inside a `mailto:` body,
 * where RFC 6068 wants `%20` and mail clients render the `+` literally. One
 * encoder for every target beats remembering which of them is the exception.
 */
const enc = encodeURIComponent;

/**
 * The targets, in the order they appear as buttons.
 *
 * Each format was checked against its own publisher's documentation where that
 * documentation is reachable, and against the consensus of current
 * implementations where it is not (X's intent endpoint, which now redirects
 * between `twitter.com` and `x.com` in both directions).
 */
export const SHARE_TARGETS: readonly ShareTarget[] = [
  {
    channel: "whatsapp",
    label: "WhatsApp",
    /**
     * WhatsApp takes ONE `text` parameter and no separate url, so the link has
     * to live inside the sentence; WhatsApp linkifies it on send. `wa.me` with
     * no phone number opens the "share with…" chat picker rather than a chat
     * with a specific person, which is what a marketing link wants.
     */
    href: ({ url, text }) => `https://wa.me/?text=${enc(`${text} ${url}`)}`,
  },
  {
    channel: "telegram",
    label: "Telegram",
    href: ({ url, text }) =>
      `https://t.me/share/url?url=${enc(url)}&text=${enc(text)}`,
  },
  {
    channel: "twitter",
    label: "X",
    /**
     * `twitter.com/intent/tweet` rather than `x.com/intent/post`: it is the
     * form Twitter's own web-intents documentation describes, and it still
     * redirects to the new host. The reverse redirect also works, so this is a
     * choice of which spelling is better evidenced, not of which one functions.
     */
    href: ({ url, text }) =>
      `https://twitter.com/intent/tweet?url=${enc(url)}&text=${enc(text)}`,
  },
  {
    channel: "reddit",
    label: "Reddit",
    /** `title`, not `text` — Reddit pre-fills the composer's title field. */
    href: ({ url, text }) =>
      `https://www.reddit.com/submit?url=${enc(url)}&title=${enc(text)}`,
  },
  {
    channel: "email",
    label: "Email",
    /**
     * No recipient, so it opens an empty compose window in whatever the
     * machine's mail handler is. The URL goes in the body on its own line
     * because mail clients linkify a bare URL and not a bracketed one.
     */
    href: ({ url, text }) => `mailto:?subject=${enc(text)}&body=${enc(`${text}\n\n${url}`)}`,
  },
] as const;

/**
 * The composer URL for one target and one destination.
 *
 * THE ONLY WAY A BUTTON SHOULD BUILD ITS LINK. It tags the path with the
 * target's own channel, so the `ref` and the button agree by construction
 * rather than by whoever wired the component up remembering to pass the right
 * one.
 */
export function shareHref(
  target: ShareTarget,
  path: string,
  text: string,
): string {
  return target.href({ url: taggedUrl(path, target.channel), text });
}

/**
 * The sentence that goes with a shared link.
 *
 * Kept here beside the targets so every button says the same thing, and so the
 * wording is testable without rendering anything. Deliberately plain: it is
 * read by the person doing the sharing, who edits it in the composer before
 * sending — every target above opens an editable draft, none of them post.
 */
export function shareText(destinationLabel: string): string {
  return `${destinationLabel} — free to play at HALLPASS`;
}
