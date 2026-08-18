import { describe, expect, it } from "vitest";
import {
  WHATS_NEW_PATH,
  WHATS_NEW_URL,
  whatsNewOrigin,
} from "@/app/lib/whats-new";

describe("the changelog's URLs", () => {
  it("keeps the source of truth on its own origin, over https", () => {
    const url = new URL(WHATS_NEW_URL);
    expect(url.protocol).toBe("https:");
    expect(url.host).not.toBe("");
  });

  it("derives the preconnect origin from that same URL", () => {
    expect(WHATS_NEW_URL.startsWith(whatsNewOrigin())).toBe(true);
    expect(whatsNewOrigin()).toBe(new URL(WHATS_NEW_URL).origin);
  });

  it("routes our own page at a site-relative path", () => {
    expect(WHATS_NEW_PATH.startsWith("/")).toBe(true);
    expect(WHATS_NEW_PATH).not.toMatch(/^https?:/);
  });

  it("does not point our page at the hosted one — that was the whole change", () => {
    expect(WHATS_NEW_PATH).not.toBe(WHATS_NEW_URL);
  });
});
