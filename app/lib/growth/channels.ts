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
 * Where a channel sits in the builder's picker.
 *
 * PRESENTATION ONLY — it never reaches a URL, never reaches analytics, and two
 * channels in different groups are no more distinct than two in the same one.
 * It exists because the vocabulary outgrew a flat list: sixteen options in one
 * `<select>` is a wall to read, and the destination picker beside it already
 * groups its options, so the two now behave the same way.
 */
export type ChannelGroup = "Social" | "Chat apps" | "Direct" | "Offline" | "Other";

export type Channel = {
  /** The literal `ref` value, and the URL-safe id used everywhere. */
  id: string;
  /** How it reads in the dashboard. */
  label: string;
  /** What a link tagged this way is FOR — shown in the builder, not stored. */
  note: string;
  /** Heading it sits under in the builder's picker. Never stored. */
  group: ChannelGroup;
};

/**
 * The vocabulary.
 *
 * Started as a GUESS (`marketing-design.md` §0) and has since been widened to
 * the places this audience actually passes a link around — the messaging apps
 * above all, because a link into a group chat is how a game reaches a whole
 * year group in an afternoon. Editing this array is the whole cost of changing
 * it; no migration, no backfill, and old events keep whatever they were tagged
 * with.
 *
 * TWO ASYMMETRIC EDITS, worth knowing apart before making either. ADDING an
 * entry is free: nothing existing moves. REMOVING one is not an undo — codes
 * are unstored (§4b), so a link already published carrying that code keeps
 * working and simply reports as `unknown` from then on, and history keeps its
 * raw tag either way. Prefer leaving a dead channel in the list over deleting
 * it, unless the point IS to make its ongoing traffic visible as unrecognised.
 *
 * ORDER IS THE UI. The first entry is what the builder selects by default, and
 * groups appear in the order they first occur here — so a channel added to an
 * existing group belongs beside its siblings, not appended at the end.
 *
 * Every id must survive {@link normalizeRef} unchanged and stay inside
 * {@link REF_MAX_LENGTH}; `channels.test.ts` enforces both, because an id that
 * normalises to something else would tag links with a code the readout then
 * files under `unknown`.
 */
export const CHANNELS: readonly Channel[] = [
  // Social — a link published to an audience, mostly read off a screen.
  { id: "tiktok", label: "TikTok", note: "Bio links and video captions.", group: "Social" },
  {
    id: "youtube",
    label: "YouTube",
    note: "Video descriptions and pinned comments.",
    group: "Social",
  },
  {
    id: "instagram",
    label: "Instagram",
    note: "Bio link, stories and DMs. No web share intent — copy the link.",
    group: "Social",
  },
  { id: "twitter", label: "X / Twitter", note: "Posts and replies.", group: "Social" },
  {
    id: "reddit",
    label: "Reddit",
    note: "Comments and subreddit posts.",
    group: "Social",
  },

  // Chat apps — a link forwarded between people. The whole point of the widening.
  {
    id: "whatsapp",
    label: "WhatsApp",
    note: "Group chats, where one paste reaches a year group.",
    group: "Chat apps",
  },
  {
    id: "snapchat",
    label: "Snapchat",
    note: "Snaps, stories and chat. Paste it — Snap has no verified web share.",
    group: "Chat apps",
  },
  {
    id: "discord",
    label: "Discord",
    note: "Server posts and pins.",
    group: "Chat apps",
  },
  {
    id: "telegram",
    label: "Telegram",
    note: "Channels and group chats.",
    group: "Chat apps",
  },
  {
    id: "messages",
    label: "Texts / iMessage",
    note: "Phone to phone, where a link is often retyped.",
    group: "Chat apps",
  },

  // Direct — sent to named people rather than posted at an audience.
  {
    id: "email",
    label: "Email",
    note: "Anything sent as mail, to anyone.",
    group: "Direct",
  },
  {
    id: "classroom",
    label: "Google Classroom",
    note: "Stream posts and comments.",
    group: "Direct",
  },
  {
    id: "friend",
    label: "Word of mouth",
    note: "For links people are told to type.",
    group: "Direct",
  },

  // Offline — the codes that have to survive being read off a wall.
  {
    id: "qr",
    label: "QR code",
    note: "Anything scanned off a screen or print.",
    group: "Offline",
  },
  {
    id: "poster",
    label: "Poster / print",
    note: "Typed by hand, so keep it short.",
    group: "Offline",
  },

  {
    id: "other",
    label: "Other",
    note: "Deliberate catch-all — not the same as unknown.",
    group: "Other",
  },
] as const;

/**
 * {@link CHANNELS} folded into its groups, in the order they first appear.
 *
 * Lives here rather than in the builder so the picker's shape is covered by the
 * same node-environment test as the vocabulary itself, and so a second consumer
 * cannot order the groups differently.
 */
export function channelsByGroup(): [ChannelGroup, Channel[]][] {
  const byGroup = new Map<ChannelGroup, Channel[]>();
  for (const channel of CHANNELS) {
    const list = byGroup.get(channel.group);
    if (list) list.push(channel);
    else byGroup.set(channel.group, [channel]);
  }
  return [...byGroup.entries()];
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
