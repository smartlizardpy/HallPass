/**
 * HallPass — the marketing `ref` vocabulary.
 *
 * A `ref` is where a visit came from, as WE label it: `?ref=tiktok`. It sits
 * alongside the `utm_*` parameters rather than replacing them, and the split of
 * responsibility matters.
 *
 * `posthog-js` already captures `utm_source/medium/campaign/content/term` and a
 * long list of ad click IDs, first-touch and last-touch, with no code from us.
 * That is the right tool for a link somebody CLICKS. It is the wrong tool for how
 * this audience actually spreads a site: read off a friend's screen at a desk,
 * typed from memory, written on a whiteboard, pasted into a bio with the query
 * string trimmed off by the app. `?utm_source=tiktok&utm_medium=social` does not
 * survive any of that. `?ref=tiktok` does.
 *
 * So this module owns a SHORT, TYPABLE, CONTROLLED vocabulary — and controlled is
 * the load-bearing word. Free-text refs look harmless and rot fast: `?ref=tik-tok`
 * one week and `?ref=tiktok` the next are two channels in every chart, and nobody
 * notices until the numbers are already split. {@link bucketRef} therefore folds
 * anything unrecognised into a single `unknown` bucket, so a typo shows up AS a
 * typo instead of quietly becoming a channel.
 *
 * NOTHING IS STORED SERVER-SIDE. There is no table and no migration: a `ref` is a
 * string reported to analytics and read back in aggregate. The cost of that,
 * stated so it stays a choice, is that a code cannot be revoked or renamed after
 * it is published. The trigger to revisit is real usage — if the team is minting
 * many codes, or wants one dead, that is when a table earns itself. See
 * `marketing-design.md` §4b.
 *
 * Deliberately has NO `import "server-only"`: the dashboard link builder runs
 * this in the browser, and `first-touch.ts` needs {@link normalizeRef} on the
 * client too. Pure and dependency-free apart from the site origin, so it unit
 * tests in the plain `node` environment like `username.ts` and `guard.ts`.
 */

import { SITE_URL } from "@/app/lib/site";

/**
 * The query parameter itself.
 *
 * Registered with PostHog through `custom_campaign_params` in
 * `instrumentation-client.ts`, so it rides the same capture pipeline as `utm_*`
 * rather than a parser of ours that could drift from it.
 */
export const REF_PARAM = "ref";

/** Longest `ref` we will accept. Long enough to read aloud, short enough to type. */
export const REF_MAX_LENGTH = 24;

/** The bucket every unrecognised `ref` folds into. Never a real channel. */
export const UNKNOWN_CHANNEL = "unknown";

/**
 * The headings the builder's picker is divided into, in the order they appear.
 *
 * Purely a presentation device: a group is never written into a URL, never
 * reported, and never read back. It exists because a flat list stops being
 * scannable somewhere around a dozen entries, and the vocabulary is now past
 * that. Reporting still buckets by {@link Channel.id} alone, so regrouping a
 * channel tomorrow changes a dropdown and nothing else.
 */
export const CHANNEL_GROUPS = [
  "Social",
  "Messaging",
  "Communities",
  "School & word of mouth",
  "Catch-all",
] as const;

export type ChannelGroup = (typeof CHANNEL_GROUPS)[number];

export type Channel = {
  /** The literal `ref` value, and the URL-safe id used everywhere. */
  id: string;
  /** How it reads in the dashboard. */
  label: string;
  /** What a link tagged this way is FOR — shown in the builder, not stored. */
  note: string;
  /** Which heading it sits under in the builder. Never leaves the picker. */
  group: ChannelGroup;
};

/**
 * The starting vocabulary.
 *
 * A GUESS, and flagged as one in `marketing-design.md` §0 — it was written while
 * nobody was available to say which channels are actually live. Editing this
 * array is the whole cost of correcting it; no migration, no backfill, and old
 * events keep whatever they were tagged with. Removing an entry does not erase
 * history, it just moves that channel into `unknown` from then on.
 */
export const CHANNELS: readonly Channel[] = [
  { id: "tiktok", label: "TikTok", note: "Bio links and video captions.", group: "Social" },
  { id: "youtube", label: "YouTube", note: "Video descriptions and pinned comments.", group: "Social" },
  { id: "whatsapp", label: "WhatsApp", note: "Group chats, where the card is most of what gets seen.", group: "Messaging" },
  { id: "discord", label: "Discord", note: "Server posts and pins.", group: "Communities" },
  { id: "reddit", label: "Reddit", note: "Comments and subreddit posts.", group: "Communities" },
  { id: "qr", label: "QR code", note: "Anything scanned off a screen or print.", group: "School & word of mouth" },
  { id: "poster", label: "Poster / print", note: "Typed by hand, so keep it short.", group: "School & word of mouth" },
  { id: "friend", label: "Word of mouth", note: "For links people are told to type.", group: "School & word of mouth" },
  { id: "other", label: "Other", note: "Deliberate catch-all — not the same as unknown.", group: "Catch-all" },
] as const;

/**
 * The channel the builder opens on.
 *
 * Named rather than read off `CHANNELS[0]`, because the array's order is a
 * presentation decision now that the picker groups it — reordering the list to
 * read better should not quietly change what an untouched link gets tagged with.
 */
export const DEFAULT_CHANNEL = "tiktok";

/**
 * The vocabulary as the picker wants it: groups in {@link CHANNEL_GROUPS} order,
 * each with its channels in the order they appear in {@link CHANNELS}.
 *
 * A group with no channels is dropped rather than emitted empty, so deleting the
 * last entry of a group removes its heading instead of leaving a hollow one — the
 * cost of a group being one line of data on a channel rather than a second list
 * to keep in sync.
 */
export function channelsByGroup(): [ChannelGroup, Channel[]][] {
  return CHANNEL_GROUPS.map(
    (group) => [group, CHANNELS.filter((c) => c.group === group)] as [ChannelGroup, Channel[]],
  ).filter(([, items]) => items.length > 0);
}

/**
 * Normalise a raw `ref` off a URL.
 *
 * Lowercases, trims, and keeps only `[a-z0-9-]`, which is what makes
 * `?ref=TikTok`, `?ref=tiktok ` and `?ref=tiktok` one channel instead of three.
 * Returns `null` for anything that normalises to nothing, so callers get an
 * explicit absence rather than an empty string that reads as a real value.
 *
 * DOES NOT VALIDATE against {@link CHANNELS}. Normalising and recognising are
 * separate jobs: capture records what actually arrived, and only the readout
 * buckets it. Conflating them would throw away the evidence that a typo is in
 * circulation, which is the one thing that makes it fixable.
 */
export function normalizeRef(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, REF_MAX_LENGTH);
  return cleaned.length > 0 ? cleaned : null;
}

/** Is this a `ref` we publish, as opposed to one we merely received? */
export function isKnownChannel(value: unknown): boolean {
  const ref = normalizeRef(value);
  return ref !== null && CHANNELS.some((c) => c.id === ref);
}

/**
 * Fold a raw `ref` into a reporting bucket.
 *
 * Known channels keep their id; everything else — a typo, a stale code, a value
 * somebody invented — becomes {@link UNKNOWN_CHANNEL}. An absent `ref` returns
 * `null`, which the readout shows as untagged traffic. Those are genuinely
 * different facts and must not collapse into each other: no `ref` is the normal
 * case (organic search, direct), whereas `unknown` means a link IS in
 * circulation carrying a label we do not recognise.
 */
export function bucketRef(raw: unknown): string | null {
  const ref = normalizeRef(raw);
  if (ref === null) return null;
  return isKnownChannel(ref) ? ref : UNKNOWN_CHANNEL;
}

/** Human label for a bucket, for chart axes and tables. */
export function channelLabel(bucket: string | null): string {
  if (bucket === null) return "Untagged";
  if (bucket === UNKNOWN_CHANNEL) return "Unknown ref";
  return CHANNELS.find((c) => c.id === bucket)?.label ?? bucket;
}

/**
 * The builder's one-line "what a link tagged this way is FOR".
 *
 * Returns `null` rather than an empty string for anything outside the
 * vocabulary, so a caller renders nothing instead of an empty line — the same
 * absence-is-explicit rule {@link normalizeRef} follows.
 */
export function channelNote(id: unknown): string | null {
  const ref = normalizeRef(id);
  if (ref === null) return null;
  return CHANNELS.find((c) => c.id === ref)?.note ?? null;
}

/**
 * Append `?ref=` to a site-relative path.
 *
 * Preserves an existing query string and any hash, because the destinations we
 * tag are real pages — `/?q=terraria` and `/game/x#reviews` are both things
 * somebody might want to share — and silently dropping either would hand the
 * marketer a link to a different page than the one they were looking at.
 *
 * An unnormalisable channel yields the path untouched rather than `?ref=`, which
 * would be a parameter with no value for every consumer to special-case.
 */
export function taggedPath(path: string, channel: string): string {
  const ref = normalizeRef(channel);
  if (ref === null) return path;

  const hashAt = path.indexOf("#");
  const hash = hashAt === -1 ? "" : path.slice(hashAt);
  const withoutHash = hashAt === -1 ? path : path.slice(0, hashAt);
  const separator = withoutHash.includes("?") ? "&" : "?";

  return `${withoutHash}${separator}${REF_PARAM}=${encodeURIComponent(ref)}${hash}`;
}

/** The absolute, pasteable form of {@link taggedPath}. */
export function taggedUrl(path: string, channel: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${SITE_URL}${taggedPath(normalizedPath, channel)}`;
}
