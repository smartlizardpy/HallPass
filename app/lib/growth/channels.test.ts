import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  CHANNEL_GROUPS,
  DEFAULT_CHANNEL,
  REF_MAX_LENGTH,
  UNKNOWN_CHANNEL,
  bucketRef,
  channelLabel,
  channelsByGroup,
  isKnownChannel,
  normalizeRef,
  taggedPath,
  taggedUrl,
} from "./channels";
import { SITE_URL } from "@/app/lib/site";

describe("normalizeRef", () => {
  it("lowercases and trims, so one channel does not become three", () => {
    expect(normalizeRef("TikTok")).toBe("tiktok");
    expect(normalizeRef("  tiktok  ")).toBe("tiktok");
    expect(normalizeRef("TIKTOK")).toBe("tiktok");
  });

  it("keeps only [a-z0-9-]", () => {
    expect(normalizeRef("tik_tok!")).toBe("tiktok");
    expect(normalizeRef("summer-2026")).toBe("summer-2026");
    expect(normalizeRef("<script>")).toBe("script");
  });

  it("caps length", () => {
    const long = "a".repeat(REF_MAX_LENGTH + 20);
    expect(normalizeRef(long)).toHaveLength(REF_MAX_LENGTH);
  });

  it("returns null for an absent or empty-after-cleaning value", () => {
    expect(normalizeRef(null)).toBeNull();
    expect(normalizeRef(undefined)).toBeNull();
    expect(normalizeRef(42)).toBeNull();
    expect(normalizeRef("")).toBeNull();
    expect(normalizeRef("   ")).toBeNull();
    // Cleaning can empty a non-empty string — that is an absent ref, not "".
    expect(normalizeRef("!!!")).toBeNull();
  });
});

describe("isKnownChannel", () => {
  it("recognises every published channel, normalised or not", () => {
    for (const channel of CHANNELS) {
      expect(isKnownChannel(channel.id)).toBe(true);
      expect(isKnownChannel(channel.id.toUpperCase())).toBe(true);
    }
  });

  it("rejects a value we never published", () => {
    expect(isKnownChannel("tik-tok")).toBe(false);
    expect(isKnownChannel("")).toBe(false);
    expect(isKnownChannel(null)).toBe(false);
  });
});

describe("bucketRef", () => {
  it("keeps a known channel's id", () => {
    expect(bucketRef("discord")).toBe("discord");
    expect(bucketRef("  Discord ")).toBe("discord");
  });

  it("folds an unrecognised ref into one bucket, so a typo reads as a typo", () => {
    expect(bucketRef("tik-tok")).toBe(UNKNOWN_CHANNEL);
    expect(bucketRef("whatever")).toBe(UNKNOWN_CHANNEL);
  });

  /**
   * The distinction the whole readout rests on: no ref at all is the NORMAL
   * case (organic search, direct, a trimmed link), whereas `unknown` means a
   * tagged link is in circulation carrying a label we do not recognise. One is
   * nothing to investigate and the other is.
   */
  it("separates untagged traffic from an unrecognised tag", () => {
    expect(bucketRef(null)).toBeNull();
    expect(bucketRef("")).toBeNull();
    expect(bucketRef("nonsense")).toBe(UNKNOWN_CHANNEL);
  });
});

describe("channelLabel", () => {
  it("labels the three cases distinctly", () => {
    expect(channelLabel("tiktok")).toBe("TikTok");
    expect(channelLabel(null)).toBe("Untagged");
    expect(channelLabel(UNKNOWN_CHANNEL)).toBe("Unknown ref");
  });

  it("falls back to the raw bucket for a channel removed from the list", () => {
    // History keeps its tag when an entry is deleted from CHANNELS.
    expect(channelLabel("retired-channel")).toBe("retired-channel");
  });
});

describe("taggedPath", () => {
  it("appends with ? on a bare path", () => {
    expect(taggedPath("/game/duskfall", "tiktok")).toBe("/game/duskfall?ref=tiktok");
  });

  it("appends with & when a query already exists", () => {
    expect(taggedPath("/?q=terraria", "discord")).toBe("/?q=terraria&ref=discord");
  });

  it("keeps the hash last, where a fragment has to be", () => {
    expect(taggedPath("/game/x#reviews", "qr")).toBe("/game/x?ref=qr#reviews");
    expect(taggedPath("/?q=a#b", "qr")).toBe("/?q=a&ref=qr#b");
  });

  it("returns the path untouched rather than emitting a valueless ref", () => {
    expect(taggedPath("/game/x", "!!!")).toBe("/game/x");
    expect(taggedPath("/game/x", "")).toBe("/game/x");
  });

  it("normalises the channel it writes", () => {
    expect(taggedPath("/", "TikTok")).toBe("/?ref=tiktok");
  });
});

describe("taggedUrl", () => {
  it("produces a pasteable absolute URL", () => {
    expect(taggedUrl("/game/duskfall", "poster")).toBe(
      `${SITE_URL}/game/duskfall?ref=poster`,
    );
  });

  it("tolerates a path missing its leading slash", () => {
    expect(taggedUrl("game/duskfall", "poster")).toBe(
      `${SITE_URL}/game/duskfall?ref=poster`,
    );
  });
});

describe("channelsByGroup", () => {
  it("lists every channel exactly once, in declared order", () => {
    const flattened = channelsByGroup().flatMap(([, items]) => items);
    expect(flattened).toEqual([...CHANNELS]);
  });

  it("keeps the groups in CHANNEL_GROUPS order", () => {
    const groups = channelsByGroup().map(([group]) => group);
    expect(groups).toEqual(CHANNEL_GROUPS.filter((g) => groups.includes(g)));
  });

  it("emits no empty group, so a heading cannot outlive its channels", () => {
    for (const [, items] of channelsByGroup()) expect(items.length).toBeGreaterThan(0);
  });
});

describe("DEFAULT_CHANNEL", () => {
  it("is a channel we actually publish", () => {
    expect(isKnownChannel(DEFAULT_CHANNEL)).toBe(true);
  });
});
