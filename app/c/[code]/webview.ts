/**
 * HallPass — escaping a chat app's in-app browser.
 *
 * PURE, and separated from the component for the usual reason: user-agent
 * sniffing is guesswork with a shelf life, and guesswork that can be unit-tested
 * against real strings ages better than guesswork buried in an event handler.
 *
 * ── THE PROBLEM ────────────────────────────────────────────────────────────
 * A challenge link's whole life is inside a chat app, so its DEFAULT
 * environment is Instagram's or Snapchat's in-app browser, not Safari. Google
 * refuses OAuth inside embedded webviews (`disallowed_useragent`), so for those
 * visitors the sign-in at the end of the flow can fail outright — and on iOS,
 * web push only works for a PWA added to the home screen, which an in-app
 * browser can never do. Getting them into the real browser is worth something
 * beyond conversion.
 *
 * ── WHY THE HOP FIRES ON THE "BEAT IT" TAP ─────────────────────────────────
 * Two reasons, and the second is the one that makes it safe.
 *
 *  1. A user GESTURE. Webviews routinely block a custom-scheme navigation that
 *     fires on load and allow the same one behind a tap.
 *  2. NOTHING HAS HAPPENED YET. No score, no claim token, no session. Later in
 *     the flow a hop would be destructive — `sdk/src/client.ts` keeps claim
 *     tokens in memory only, so leaving the document bins the score we are
 *     about to ask them to keep. Before the game starts there is nothing to
 *     lose, which is precisely why this is the only moment it can happen.
 *
 * ── IT IS EXPECTED TO FAIL OFTEN, AND THAT IS DESIGNED FOR ─────────────────
 * `x-safari-https:` is undocumented, reportedly patched in some hosts and
 * inconsistent across iOS versions; TikTok has no known escape at all. So the
 * caller races it against {@link ESCAPE_BAILOUT_MS} and plays in place when
 * nothing happens. A failed hop must cost a second, not a session.
 *
 * NONE OF THIS IS VERIFIED AGAINST CURRENT APP BUILDS. It is behind a flag,
 * default off, and the telemetry is what should decide whether it stays.
 */

/** Chat apps whose in-app browser we recognise. */
export type InAppBrowser = "instagram" | "facebook" | "snapchat" | "tiktok";

export type MobileOs = "ios" | "android";

/**
 * Which chat app's browser this is, or `null` for an ordinary one.
 *
 * Ordered most-specific first: Instagram's user agent also carries the Facebook
 * `FB` tokens on some builds, so testing for Facebook first would mislabel it.
 * The label only picks the telemetry bucket — every recognised host is treated
 * the same — so a mislabel is cosmetic, and a MISS is the safe failure: an
 * unrecognised browser simply never gets offered the hop.
 */
export function detectInAppBrowser(ua: string): InAppBrowser | null {
  const s = String(ua ?? "");
  if (/Instagram/i.test(s)) return "instagram";
  if (/\bFBAN\b|\bFBAV\b|\bFB_IAB\b/.test(s)) return "facebook";
  if (/Snapchat/i.test(s)) return "snapchat";
  if (/BytedanceWebview|musical_ly|\bTikTok\b/i.test(s)) return "tiktok";
  return null;
}

/** iOS or Android, or `null` for anything else (including desktop). */
export function detectMobileOs(ua: string): MobileOs | null {
  const s = String(ua ?? "");
  // iPadOS 13+ reports as a Mac; the touch-point check that would disambiguate
  // it needs `navigator`, so it stays in the component. A desktop Mac falling
  // through to `null` is the harmless direction.
  if (/iPhone|iPad|iPod/i.test(s)) return "ios";
  if (/Android/i.test(s)) return "android";
  return null;
}

/**
 * A URL that asks the OS to reopen `url` in the real browser, or `null` when
 * there is no known way to.
 *
 * iOS: the undocumented `x-safari-` scheme prefix. Unsupported navigation in a
 * webview typically does nothing at all, which is why attempting it is safe.
 *
 * Android: a standard `intent://` with a Chrome package hint and an
 * `S.browser_fallback_url`, so a device with no Chrome still lands somewhere
 * rather than on an error page.
 */
export function escapeUrlFor(os: MobileOs | null, url: string): string | null {
  if (!url.startsWith("https://")) return null;
  if (os === "ios") return `x-safari-${url}`;
  if (os === "android") {
    const withoutScheme = url.slice("https://".length);
    return (
      `intent://${withoutScheme}#Intent;scheme=https;` +
      `package=com.android.chrome;` +
      `S.browser_fallback_url=${encodeURIComponent(url)};end`
    );
  }
  return null;
}

/**
 * How long to wait for the hop before giving up and playing here.
 *
 * A successful escape backgrounds this document almost immediately, so the
 * caller watches `visibilitychange` and only this timer has to be generous
 * enough for a slow handoff. It is charged to the highest-traffic step in the
 * funnel, so it is deliberately short: better to occasionally play in the
 * webview than to make everybody wait.
 */
export const ESCAPE_BAILOUT_MS = 1200;

/** The PostHog flag that turns the hop on. Absent or off means never attempt. */
export const ESCAPE_FLAG = "challenge-link-webview-escape";
