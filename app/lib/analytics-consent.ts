/**
 * HallPass — the analytics opt-out, as a tiny per-device preference.
 *
 * PostHog runs on every page (`instrumentation-client.ts`) with its default
 * storage, which keeps a device ID so retention can be counted. For an audience
 * of school-age kids we keep that, but let anyone switch it off: this module
 * owns ONLY the stored choice. It does not import the SDK, so it is trivially
 * testable and safe to import from anywhere (including `first-touch.ts`). The
 * code that tells PostHog about the choice lives in `instrumentation-client.ts`,
 * which listens for {@link ANALYTICS_CHOICE_EVENT}.
 *
 * Everything touching `localStorage` is wrapped: it throws in some private
 * windows, with blocked site data, and in sandboxed iframes. Failing to READ
 * means "not opted out" (the default is ON); failing to WRITE is swallowed, but
 * the in-tab event still fires so the SDK is switched off for this page view.
 *
 * `hp:analytics-optout` holds `"1"` when opted out; absent means analytics ON.
 * `hp:analytics-notice-seen` holds `"1"` once the one-time notice was dismissed.
 */

export const ANALYTICS_OPTOUT_KEY = "hp:analytics-optout";
export const ANALYTICS_NOTICE_SEEN_KEY = "hp:analytics-notice-seen";

/** Fired on `window` (same tab) whenever the choice changes. `detail` is the opt-out boolean. */
export const ANALYTICS_CHOICE_EVENT = "hp:analytics-choice";

/** The slice of `Storage` we need — lets tests pass a fake without jsdom. */
type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** True when this device has opted out of analytics. Defaults to false. */
export function isAnalyticsOptedOut(
  storage: StorageLike | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(ANALYTICS_OPTOUT_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Store the choice and tell this tab. Opting back in REMOVES the key rather than
 * writing "0", so the default state leaves no trace on the device.
 */
export function setAnalyticsOptOut(
  optedOut: boolean,
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    if (optedOut) storage?.setItem(ANALYTICS_OPTOUT_KEY, "1");
    else storage?.removeItem(ANALYTICS_OPTOUT_KEY);
  } catch {
    /* Storage unavailable — the event below still applies it to this page view. */
  }
  if (typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(ANALYTICS_CHOICE_EVENT, { detail: optedOut }),
      );
    } catch {
      /* ignore */
    }
  }
}

/** Has the one-time analytics notice been dismissed on this device? */
export function hasSeenAnalyticsNotice(
  storage: StorageLike | null = defaultStorage(),
): boolean {
  try {
    return storage?.getItem(ANALYTICS_NOTICE_SEEN_KEY) === "1";
  } catch {
    // Unknown: treat as seen so a device that cannot remember is not nagged on
    // every single page.
    return true;
  }
}

export function markAnalyticsNoticeSeen(
  storage: StorageLike | null = defaultStorage(),
): void {
  try {
    storage?.setItem(ANALYTICS_NOTICE_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}
