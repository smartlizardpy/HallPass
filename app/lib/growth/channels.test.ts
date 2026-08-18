import { describe, expect, it } from "vitest";
import {
  CHANNELS,
  channelsByGroup,
  REF_MAX_LENGTH,
  UNKNOWN_CHANNEL,
  bucketRef,
  channelLabel,
  isKnownChannel,
  normalizeRef,
  taggedPath,
  taggedUrl,
} from "./channels";
import { SITE_URL } from "@/app/lib/site";

/**
 * The vocabulary's own invariants. These are not style checks: an id that
 * does not survive `normalizeRef` would have the builder publish a link whose
 * `ref` the readout then files under `unknown`, and a duplicate id would put
 * two rows in the picker that mean the same channel.
 */
describe("CHANNELS", () => {
  it("has ids that survive normalisation unchanged", () => {
    for (const channel of CHANNELS) {
      expect(normalizeRef(channel.id)).toBe(channel.id);
    }
  });

  it("has ids inside the typable length limit", () => {
    for (const channel of CHANNELS) {
      expect(channel.id.length).toBeLessThanOrEqual(REF_MAX_LENGTH);
    }
  });

  it("has no duplicate ids", () => {
    const ids = CHANNELS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every channel a label and a note to pick it by", () => {
    for (const channel of CHANNELS) {
      expect(channel.label.length).toBeGreaterThan(0);
      expect(channel.note.length).toBeGreaterThan(0);
    }
  });

  it("carries the messaging channels the builder was widened for", () => {
    for (const id of ["whatsapp", "snapchat", "telegram", "messages"]) {
      expect(isKnownChannel(id)).toBe(true);
      expect(bucketRef(id)).toBe(id);
    }
  });
});

describe("channelsByGroup", () => {
  it("covers every channel exactly once", () => {
    const grouped = channelsByGroup().flatMap(([, items]) => items);
    expect(grouped).toEqual([...CHANNELS]);
  });

  it("orders groups by where they first appear, and keeps siblings together", () => {
    const groups = channelsByGroup().map(([group]) => group);
    expect(groups).toEqual([...new Set(CHANNELS.map((c) => c.group))]);
    // A channel added to an existing group must not open a second heading.
    expect(new Set(groups).size).toBe(groups.length);
  });
});

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
