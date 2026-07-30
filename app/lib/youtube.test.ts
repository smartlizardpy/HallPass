import { describe, expect, it } from "vitest";
import {
  isYouTubeId,
  parseYouTubeId,
  youtubeEmbedUrl,
  youtubeWatchUrl,
} from "./youtube";

/** A syntactically valid id — 11 chars of the URL-safe base64 alphabet. */
const ID = "dQw4w9WgXcQ";
/** Exercises both non-alphanumeric characters the alphabet allows. */
const ID_WITH_SYMBOLS = "a-b_c9DEFGH";

describe("isYouTubeId", () => {
  it("accepts exactly 11 URL-safe base64 characters", () => {
    expect(isYouTubeId(ID)).toBe(true);
    expect(isYouTubeId(ID_WITH_SYMBOLS)).toBe(true);
  });

  it("rejects the wrong length", () => {
    expect(isYouTubeId("tooShort")).toBe(false);
    expect(isYouTubeId(`${ID}extra`)).toBe(false);
  });

  it("rejects characters outside the alphabet", () => {
    expect(isYouTubeId("dQw4w9WgXc!")).toBe(false);
    expect(isYouTubeId("dQw4w9WgXc/")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isYouTubeId(null)).toBe(false);
    expect(isYouTubeId(undefined)).toBe(false);
    expect(isYouTubeId(11)).toBe(false);
  });
});

describe("parseYouTubeId", () => {
  it("passes a bare id through", () => {
    expect(parseYouTubeId(ID)).toBe(ID);
    expect(parseYouTubeId(ID_WITH_SYMBOLS)).toBe(ID_WITH_SYMBOLS);
  });

  it("reads the watch?v= form", () => {
    expect(parseYouTubeId(`https://www.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`http://youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("reads youtu.be short links", () => {
    expect(parseYouTubeId(`https://youtu.be/${ID}`)).toBe(ID);
  });

  it("reads the path forms", () => {
    expect(parseYouTubeId(`https://www.youtube.com/embed/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/shorts/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/live/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube.com/v/${ID}`)).toBe(ID);
  });

  it("reads the alternate hosts, including the no-cookie embed host", () => {
    expect(parseYouTubeId(`https://m.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://music.youtube.com/watch?v=${ID}`)).toBe(ID);
    expect(parseYouTubeId(`https://www.youtube-nocookie.com/embed/${ID}`)).toBe(ID);
  });

  it("discards every extra query parameter", () => {
    expect(
      parseYouTubeId(`https://www.youtube.com/watch?v=${ID}&t=30s&list=PLabc`),
    ).toBe(ID);
    expect(parseYouTubeId(`https://youtu.be/${ID}?t=30&si=trackingjunk`)).toBe(ID);
  });

  it("accepts the scheme-less pastes people actually produce", () => {
    expect(parseYouTubeId(`youtu.be/${ID}`)).toBe(ID);
    expect(parseYouTubeId(`www.youtube.com/watch?v=${ID}`)).toBe(ID);
  });

  it("trims surrounding whitespace", () => {
    expect(parseYouTubeId(`  https://youtu.be/${ID}\n`)).toBe(ID);
  });

  /**
   * The case a bare `[?&]v=` regex gets wrong, and the reason this module parses
   * the host instead. The extracted id is perfectly valid — only the host is not.
   */
  it("rejects a valid id on a non-YouTube host", () => {
    expect(parseYouTubeId(`https://evil.example/watch?v=${ID}`)).toBeNull();
    expect(parseYouTubeId(`https://vimeo.com/embed/${ID}`)).toBeNull();
    expect(parseYouTubeId(`https://youtube.com.evil.example/watch?v=${ID}`)).toBeNull();
  });

  /**
   * `new URL("javascript://youtu.be/x")` really does report `youtu.be` as its
   * hostname, so the host allow-list alone would let this through.
   */
  it("rejects non-http(s) schemes on an allowed host", () => {
    expect(parseYouTubeId(`javascript://youtu.be/${ID}`)).toBeNull();
    expect(parseYouTubeId(`data://www.youtube.com/watch?v=${ID}`)).toBeNull();
  });

  it("rejects YouTube URLs that name no video", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch")).toBeNull();
    expect(parseYouTubeId("https://youtu.be/")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/embed/")).toBeNull();
    expect(parseYouTubeId("https://www.youtube.com/@somechannel")).toBeNull();
  });

  it("rejects ids of the wrong length inside a valid URL", () => {
    expect(parseYouTubeId("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseYouTubeId(`https://youtu.be/${ID}extra`)).toBeNull();
  });

  it("rejects junk", () => {
    expect(parseYouTubeId("")).toBeNull();
    expect(parseYouTubeId("   ")).toBeNull();
    expect(parseYouTubeId("not a url")).toBeNull();
    expect(parseYouTubeId(null)).toBeNull();
    expect(parseYouTubeId(undefined)).toBeNull();
    expect(parseYouTubeId(42)).toBeNull();
  });
});

describe("youtubeEmbedUrl", () => {
  it("uses the no-cookie host", () => {
    expect(youtubeEmbedUrl(ID)).toContain("https://www.youtube-nocookie.com/embed/");
  });

  it("embeds the id in the path", () => {
    expect(youtubeEmbedUrl(ID).startsWith(
      `https://www.youtube-nocookie.com/embed/${ID}?`,
    )).toBe(true);
  });

  it("autoplays by default and can be told not to", () => {
    expect(youtubeEmbedUrl(ID)).toContain("autoplay=1");
    expect(youtubeEmbedUrl(ID, { autoplay: false })).not.toContain("autoplay");
  });

  it("carries the containment parameters", () => {
    const url = youtubeEmbedUrl(ID);
    expect(url).toContain("rel=0");
    expect(url).toContain("modestbranding=1");
    expect(url).toContain("playsinline=1");
    expect(url).toContain("iv_load_policy=3");
  });

  it("escapes an id that should never have reached it", () => {
    // Three layers guard this column; if all three failed, the value must still
    // not break out of the path segment into the query string.
    expect(youtubeEmbedUrl("a?b&c=d")).toContain("a%3Fb%26c%3Dd");
  });
});

describe("youtubeWatchUrl", () => {
  it("links to the canonical watch page, not the embed host", () => {
    expect(youtubeWatchUrl(ID)).toBe(`https://www.youtube.com/watch?v=${ID}`);
  });
});
