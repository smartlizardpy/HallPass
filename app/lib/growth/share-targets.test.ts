import { describe, expect, it } from "vitest";
import { SHARE_TARGETS, shareHref, shareText } from "./share-targets";
import { REF_PARAM, isKnownChannel } from "./channels";
import { SITE_URL } from "@/app/lib/site";

/** The tagged link a target was handed, dug back out of the composer URL. */
function sharedUrl(href: string): string {
  const composer = new URL(href);
  // Telegram/X/Reddit pass the link as its own parameter; WhatsApp and mail
  // carry it inside the message text.
  const explicit = composer.searchParams.get("url");
  if (explicit) return explicit;
  const text = composer.searchParams.get("text") ?? composer.searchParams.get("body") ?? "";
  const found = text.match(/https?:\/\/\S+/);
  return found ? found[0] : "";
}

describe("SHARE_TARGETS", () => {
  it("names only channels we publish", () => {
    for (const target of SHARE_TARGETS) {
      expect(isKnownChannel(target.channel)).toBe(true);
    }
  });

  it("has one button per channel", () => {
    const channels = SHARE_TARGETS.map((t) => t.channel);
    expect(new Set(channels).size).toBe(channels.length);
  });

  /**
   * The reason the module exists. A button that opened WhatsApp with a link
   * tagged `tiktok` would quietly file the whole channel's traffic under the
   * wrong heading, and nothing on the page would look wrong.
   */
  it("tags every link with the button's own channel", () => {
    for (const target of SHARE_TARGETS) {
      const href = shareHref(target, "/game/duskfall", "hello");
      const tagged = new URL(sharedUrl(href));
      expect(tagged.searchParams.get(REF_PARAM)).toBe(target.channel);
      expect(tagged.origin).toBe(new URL(SITE_URL).origin);
      expect(tagged.pathname).toBe("/game/duskfall");
    }
  });

  it("keeps a destination's own query string intact", () => {
    for (const target of SHARE_TARGETS) {
      const tagged = new URL(sharedUrl(shareHref(target, "/?q=terraria", "hello")));
      expect(tagged.searchParams.get("q")).toBe("terraria");
      expect(tagged.searchParams.get(REF_PARAM)).toBe(target.channel);
    }
  });

  it("carries the message text into every composer", () => {
    for (const target of SHARE_TARGETS) {
      const href = shareHref(target, "/", "Play Duskfall");
      const composer = new URL(href);
      const shown =
        composer.searchParams.get("text") ??
        composer.searchParams.get("title") ??
        composer.searchParams.get("subject") ??
        "";
      expect(shown).toContain("Play Duskfall");
    }
  });
});

describe("target formats", () => {
  const byChannel = (channel: string) => {
    const target = SHARE_TARGETS.find((t) => t.channel === channel);
    if (!target) throw new Error(`no share target for ${channel}`);
    return target;
  };

  it("sends WhatsApp one text parameter with the link inside it", () => {
    const href = shareHref(byChannel("whatsapp"), "/", "Play HALLPASS");
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    const text = new URL(href).searchParams.get("text") ?? "";
    expect(text).toContain("Play HALLPASS");
    expect(text).toContain(`${SITE_URL}/?ref=whatsapp`);
  });

  it("uses Telegram's documented share/url endpoint", () => {
    const href = shareHref(byChannel("telegram"), "/", "hi");
    expect(href.startsWith("https://t.me/share/url?")).toBe(true);
  });

  it("uses Reddit's title parameter, which is the field it pre-fills", () => {
    const href = shareHref(byChannel("reddit"), "/", "hi");
    expect(new URL(href).searchParams.get("title")).toBe("hi");
  });

  /**
   * `URLSearchParams` would write a space as `+` here, which RFC 6068 does not
   * allow and mail clients render literally — the reason this module encodes by
   * hand.
   */
  it("percent-encodes spaces in a mailto rather than writing a plus", () => {
    const href = shareHref(byChannel("email"), "/", "two words");
    expect(href.startsWith("mailto:?")).toBe(true);
    expect(href).toContain("two%20words");
    expect(href).not.toContain("+");
  });
});

describe("shareText", () => {
  it("names the destination it is sharing", () => {
    expect(shareText("Duskfall")).toContain("Duskfall");
  });
});
