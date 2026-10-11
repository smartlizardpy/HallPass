/**
 * `/cookies` — what HALLPASS stores on your device, in plain language.
 *
 * The Privacy Policy (section 5) says the same thing in summary; this page is
 * the list a person can actually check. Every row rests on code:
 *
 *  - Session cookie: Auth.js (`app/lib/auth.ts`), JWT, about 30 days.
 *  - `hp_avatar_skip`: `app/lib/onboarding.ts` (30 days, set when you skip the
 *    avatar step so you are not asked again).
 *  - Analytics: PostHog in `instrumentation-client.ts`; the switch and notice are
 *    in `app/lib/analytics-consent.ts`; opting out clears the ID.
 *  - Browser storage keys: the `hp:*` keys (`personalization.ts`, `streak/*`,
 *    `stealth/*`, `catalog-prefs`, `analytics-consent`, …) and `hp_initial_ref*`
 *    (first-touch, `app/lib/growth/first-touch.ts`).
 *  - Service worker: `public/sw.js` (never caches `/play/you`).
 *
 * Keep it in step with the Privacy Policy. Static on purpose: no session or
 * database reads, so it prerenders.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "../components/legal/LegalPage";

const title = "Cookies and Storage";
const description =
  "Exactly what HALLPASS stores on your device, why, how long, and how to switch it off.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/cookies" },
  openGraph: { type: "website", title, description, url: "/cookies" },
};

const row = "border-t border-border align-top";
const cell = "py-2 pr-3";

export default function CookiesPage() {
  return (
    <LegalPage
      title={title}
      updated={<>11 October 2026</>}
      shortVersion={
        <ul>
          <li>
            We use no advertising cookies and no social-media trackers.
          </li>
          <li>
            If you sign in, one cookie keeps you signed in. That one is needed,
            so it does not ask permission.
          </li>
          <li>
            Most of what we keep is your own settings, saved in your browser
            and never sent to us.
          </li>
          <li>
            One thing is optional: a random analytics ID. It is on by default
            and you can switch it off in settings (section 3).
          </li>
        </ul>
      }
    >
      <LegalSection id="what" title="1. What these are">
        <p>
          Cookies and &quot;local storage&quot; are small bits of data a website
          saves in your browser. UK rules (PECR) say we must tell you about
          them, and ask first for any that are not strictly needed. This page
          lists all of ours. The <Link href="/privacy">Privacy Policy</Link>{" "}
          explains how we use data more widely.
        </p>
      </LegalSection>

      <LegalSection id="needed" title="2. Needed to run the site (no permission needed)">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[14px]">
            <thead>
              <tr className="text-foreground">
                <th className={cell}>Name</th>
                <th className={cell}>What it does</th>
                <th className={cell}>How long</th>
              </tr>
            </thead>
            <tbody>
              <tr className={row}>
                <td className={cell}>Sign-in cookie</td>
                <td className={cell}>
                  Keeps you signed in. Only set if you sign in.
                </td>
                <td className={cell}>About 30 days</td>
              </tr>
              <tr className={row}>
                <td className={cell}>
                  <code>hp_avatar_skip</code>
                </td>
                <td className={cell}>
                  Remembers that you skipped choosing an avatar, so we do not
                  ask again.
                </td>
                <td className={cell}>30 days</td>
              </tr>
              <tr className={row}>
                <td className={cell}>
                  Settings in browser storage (<code>hp:theme</code>,{" "}
                  <code>hp:favorites</code>, <code>hp:recent</code>,{" "}
                  <code>hp:streak</code>, <code>hp:catalog-sort</code>,{" "}
                  <code>hp:stealth</code> and similar)
                </td>
                <td className={cell}>
                  Your theme, favourites, recently played games, daily streak,
                  tab-disguise settings, closed banners and notification
                  preferences. They stay on your device.
                </td>
                <td className={cell}>Until you clear them</td>
              </tr>
              <tr className={row}>
                <td className={cell}>
                  <code>hp:foryou</code> / <code>hp:taste</code> (signed in
                  only)
                </td>
                <td className={cell}>
                  A count of how often you play each game, used to put games you
                  like first. It never leaves your device. Signing out or
                  turning &quot;Games picked for you&quot; off deletes it.
                </td>
                <td className={cell}>Until you sign out or switch it off</td>
              </tr>
              <tr className={row}>
                <td className={cell}>Service worker and its caches</td>
                <td className={cell}>
                  Lets HALLPASS be installed and work offline by saving public
                  pages and games. It never saves pages that show your account,
                  friends or profile.
                </td>
                <td className={cell}>Until you clear site data</td>
              </tr>
            </tbody>
          </table>
        </div>
      </LegalSection>

      <LegalSection id="analytics" title="3. Analytics (optional, on by default)">
        <table className="w-full text-left text-[14px]">
          <tbody>
            <tr className={row}>
              <td className={cell}>PostHog ID (a cookie and local storage)</td>
              <td className={cell}>
                A random ID so we can tell a returning visitor from a new one,
                plus which link first brought the device here
                (<code>hp_initial_ref</code>). It does not name you and we never
                link it to your account. We do not record your screen.
              </td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>To switch it off:</strong> use the Analytics switch in your
          settings. That stops anything being captured and deletes the ID from
          your browser. We tell you about this the first time you visit. More
          detail is in section 6 of the{" "}
          <Link href="/privacy#analytics">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection id="not" title="4. What we do not use">
        <ul>
          <li>No advertising or retargeting cookies.</li>
          <li>No Google Analytics, and no social-media pixels or trackers.</li>
          <li>
            Trailers load from YouTube (privacy-enhanced mode) only after you
            press play on one, and YouTube may then set its own cookies.
          </li>
          <li>
            Games that run from another website may set their own cookies. We
            do not control those.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="control" title="5. Clearing it all">
        <p>
          You can delete everything above in your browser&apos;s settings
          (usually under &quot;Clear browsing data&quot; or &quot;Site
          data&quot;). You will be signed out and your saved settings, favourites
          and streak on that device will reset. Questions: legal@hallpass.games.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
