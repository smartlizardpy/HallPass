import { describe, expect, it } from "vitest";
import {
  ESCAPE_BAILOUT_MS,
  detectInAppBrowser,
  detectMobileOs,
  escapeUrlFor,
} from "./webview";

/** Real-shaped user agents, kept together so the sniffing is reviewable. */
const UA = {
  instagram:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 329.0.2.28.90 (iPhone14,5; iOS 17_5)",
  facebook:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/468.0.0.47.108;FBBV/1234]",
  snapchat:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 Snapchat/12.85.0.44",
  tiktok:
    "Mozilla/5.0 (Linux; Android 13; SM-A536B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 BytedanceWebview/d8a21c6",
  safari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
  desktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
};

describe("detectInAppBrowser", () => {
  it("recognises the four chat apps a link actually travels through", () => {
    expect(detectInAppBrowser(UA.instagram)).toBe("instagram");
    expect(detectInAppBrowser(UA.facebook)).toBe("facebook");
    expect(detectInAppBrowser(UA.snapchat)).toBe("snapchat");
    expect(detectInAppBrowser(UA.tiktok)).toBe("tiktok");
  });

  /**
   * The ordering rule made explicit. Instagram's webview carries Facebook's
   * tokens on some builds, so checking Facebook first would mislabel it. The
   * label only picks a telemetry bucket, but a test is cheaper than rediscovering
   * why the buckets look wrong.
   */
  it("calls an Instagram webview Instagram even when it carries FB tokens", () => {
    const both = `${UA.instagram} [FBAN/FBIOS;FBAV/1.0]`;
    expect(detectInAppBrowser(both)).toBe("instagram");
  });

  it("leaves an ordinary browser alone — a miss is the safe failure", () => {
    expect(detectInAppBrowser(UA.safari)).toBeNull();
    expect(detectInAppBrowser(UA.chromeAndroid)).toBeNull();
    expect(detectInAppBrowser(UA.desktop)).toBeNull();
    expect(detectInAppBrowser("")).toBeNull();
    expect(detectInAppBrowser(undefined as unknown as string)).toBeNull();
  });
});

describe("detectMobileOs", () => {
  it("identifies iOS and Android", () => {
    expect(detectMobileOs(UA.instagram)).toBe("ios");
    expect(detectMobileOs(UA.snapchat)).toBe("android");
  });

  it("returns null for desktop, which is the harmless direction", () => {
    expect(detectMobileOs(UA.desktop)).toBeNull();
    expect(detectMobileOs("")).toBeNull();
  });
});

describe("escapeUrlFor", () => {
  const url = "https://hallpass.gg/c/CDFGHJKMNP";

  it("prefixes the undocumented Safari scheme on iOS", () => {
    expect(escapeUrlFor("ios", url)).toBe("x-safari-https://hallpass.gg/c/CDFGHJKMNP");
  });

  it("builds an intent with a fallback so a Chrome-less device still lands", () => {
    const intent = escapeUrlFor("android", url);
    expect(intent).toContain("intent://hallpass.gg/c/CDFGHJKMNP");
    expect(intent).toContain("scheme=https");
    expect(intent).toContain("package=com.android.chrome");
    // Without this an Android with no Chrome gets an error page instead of a game.
    expect(intent).toContain(`S.browser_fallback_url=${encodeURIComponent(url)}`);
    expect(intent?.endsWith(";end")).toBe(true);
  });

  it("has nothing to offer an unknown platform", () => {
    expect(escapeUrlFor(null, url)).toBeNull();
  });

  /**
   * A guard against turning a relative or `javascript:` URL into a scheme-
   * prefixed navigation. Everything this is called with is same-origin and
   * absolute today; the check is here so that stays true.
   */
  it("refuses anything that is not an absolute https URL", () => {
    expect(escapeUrlFor("ios", "/c/CDFGHJKMNP")).toBeNull();
    expect(escapeUrlFor("ios", "http://hallpass.gg/c/X")).toBeNull();
    expect(escapeUrlFor("android", "javascript:alert(1)")).toBeNull();
    expect(escapeUrlFor("ios", "")).toBeNull();
  });
});

describe("ESCAPE_BAILOUT_MS", () => {
  it("is short, because it is charged to the busiest step in the funnel", () => {
    expect(ESCAPE_BAILOUT_MS).toBeGreaterThan(0);
    expect(ESCAPE_BAILOUT_MS).toBeLessThanOrEqual(1500);
  });
});
