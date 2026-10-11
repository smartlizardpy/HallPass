/**
 * `/privacy` — the Privacy Policy.
 *
 * DRAFT, written from the code rather than from a template, by someone who is
 * not a lawyer. Every statement of fact below rests on a file a reader can open;
 * where the code could not settle a point it is a `Placeholder` (rendered as a
 * yellow [square-bracket] note), never a guess. Claims and where they come from:
 *
 *  - Sign-in and the `players` row (email, Google name, avatar, handle,
 *    username, country, visibility): `app/lib/auth.ts`, `app/lib/players.sql`,
 *    `app/lib/players.ts`. Google-only, JWT session, no adapter.
 *  - Deletion: `deletePlayer` in `app/lib/players.ts`, the form in
 *    `app/play/you/settings/page.tsx`. Scores are kept with the name "Deleted".
 *  - Analytics: `instrumentation-client.ts` (PostHog EU via the `/ingest`
 *    rewrite in `next.config.ts`, no `identify`), `app/lib/growth/first-touch.ts`.
 *    Session-replay and cookie defaults are NOT set in code: open question.
 *  - Device storage: the `hp:*` keys listed in the audit (personalization.ts,
 *    streak/store.ts, stealth/config.ts, catalog-prefs.ts, …), `public/sw.js`.
 *  - Avatars: shown on leaderboards (`app/lib/scoreboard/store.ts`), reviews and
 *    friends; withheld on /c/ and /i/ pages (`app/c/[code]/page.tsx`,
 *    `app/i/[code]/page.tsx`) and from co-op peers (`SHARE_AVATAR_WITH_PEERS` in
 *    `app/lib/p2p/config.ts`).
 *  - IP addresses: salted hash only, `app/lib/scoreboard/guard.ts`; country via
 *    `app/lib/geo.ts`.
 *  - Co-op: `app/lib/p2p/*`, `sdk/p2p/src/client.ts` (`iceTransportPolicy`),
 *    `docs/p2p-design.md`, migration `040_p2p_signaling.sql`.
 *  - Push, notifications, streak reminders: `app/lib/push/*`,
 *    `app/lib/notifications/*`, `app/lib/streak/*`,
 *    `.github/workflows/streak-reminders.yml`.
 *  - Reviews and their report/translate paths: `app/lib/reviews/*`.
 *  - Friends, challenges, invites: `app/lib/social/*`, `app/lib/challenges/*`,
 *    `app/lib/invites/*`, `docs/challenge-sharing-design.md`,
 *    `docs/invites-design.md`.
 *  - Beta programme and recordings: `app/lib/beta/*`, `app/lib/capture/*`,
 *    `docs/game-recorder.md`, `app/api/v1/beta/clips/[id]/route.ts`.
 *  - Surveys: `app/lib/surveys/*`.
 *
 * Static on purpose: no session or database reads, so it prerenders.
 */

import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalPage,
  LegalSection,
  Placeholder,
} from "../components/legal/LegalPage";

const title = "Privacy Policy";
const description =
  "What data HALLPASS collects, why, who sees it, how long we keep it, and your choices.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/privacy" },
  openGraph: { type: "website", title, description, url: "/privacy" },
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title={title}
      updated={<>11 October 2026 (draft)</>}
      shortVersion={
        <ul>
          <li>
            You can play without an account. Signing in (with Google) is only
            needed for scores under your name, streaks, friends and reviews.
          </li>
          <li>
            We never sell your data and we do not show personalised ads.
          </li>
          <li>
            We keep your Google email, name and profile picture. Your email and
            real Google name are never shown to other players. Your profile
            picture <strong>can</strong> be (see section 4).
          </li>
          <li>
            We count visits and clicks with an analytics tool so we can fix
            things and make better games.
          </li>
          <li>
            Online co-op connects your device to another player&apos;s, so they
            may be able to see your IP address (section 7).
          </li>
          <li>
            You must be 13 or older to have an account. If you are under 13,
            please ask a parent or carer before using the site.
          </li>
          <li>
            You can delete your account yourself in your settings. Questions or
            requests: smartlizardpy@duck.com.
          </li>
        </ul>
      }
    >
      <LegalSection id="who" title="1. Who we are">
        <p>
          HALLPASS (&quot;we&quot;, &quot;us&quot;) is a free arcade of browser
          games at{" "}
          <Placeholder>CONFIRM LIVE DOMAIN (the code currently uses
          hallpass-rouge.vercel.app)</Placeholder>. It is run from England. We
          are the &quot;controller&quot; of the personal data described here,
          which means we decide how and why it is used.
        </p>
        <p>
          Operator: Ozan Kaygusuz
          <br />
          Address: <Placeholder>POSTAL ADDRESS</Placeholder>
          <br />
          Contact for anything in this policy:{" "}
          smartlizardpy@duck.com
          <br />
          ICO registration number (if registered):{" "}
          <Placeholder>ICO REGISTRATION NUMBER OR NOT REQUIRED</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="age" title="2. Children and age">
        <p>
          Lots of our players are at school, and we have designed the site with
          that in mind: we try to collect as little as we can, profiles start
          friends-only, and we do not use your data for advertising.
        </p>
        <ul>
          <li>
            <strong>Accounts are for people aged 13 or over.</strong> Signing in
            uses a Google account, and Google has its own age rules. Many school
            Google accounts for under-18s are blocked from signing in to
            third-party sites; that is Google&apos;s setting, not ours.
          </li>
          <li>
            <strong>If you are under 13</strong>, please ask a parent or carer
            before using HALLPASS at all. Playing as a guest still involves the
            device storage and analytics described below.
          </li>
          <li>
            We do not ask your age, and we do not currently check it. We do not knowingly collect an account from anyone under 13. If we
            learn we have, or a parent or carer tells us, we will delete it.
            Parents and carers can contact us at{" "}
            smartlizardpy@duck.com to see, correct or delete
            their child&apos;s data.
          </li>
        </ul>
        <p>
          Our approach follows the ICO&apos;s Children&apos;s Code (the UK
          &quot;Age Appropriate Design Code&quot;).{" "}
          <Placeholder>SOLICITOR: confirm whether a DPIA is needed and done</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="data" title="3. What we collect, why, and our legal reason">
        <p>
          UK data protection law says we need a &quot;lawful basis&quot; for
          each use. Ours are in brackets.
        </p>
        <p>
          <strong>If you only play as a guest</strong>
        </p>
        <ul>
          <li>
            <strong>Things saved on your device</strong> (favourites, recently
            played, your daily streak, theme, tab-disguise settings, which
            banners you closed, and a guest leaderboard name). These stay in
            your browser and are not sent to us, except as below. [Needed to
            give you the features you asked for.]
          </li>
          <li>
            <strong>Scores you submit.</strong> The guest name you used, the
            score, the time, and a scrambled (&quot;hashed&quot;) version of
            your IP address, used only to stop spam and cheating. We do not
            store the IP address itself in our database. [Legitimate interests:
            running a fair leaderboard.]
          </li>
          <li>
            <strong>Analytics</strong> (section 6). [Legitimate interests, plus
            the exemption in UK cookie rules for simple statistics; see
            section 6.]
          </li>
          <li>
            <strong>Technical logs</strong> kept by our hosts when you load a
            page (such as IP address and browser type). [Legitimate interests:
            security and keeping the site running.]
          </li>
        </ul>
        <p>
          <strong>If you sign in with Google</strong>
        </p>
        <ul>
          <li>
            From Google we store your account ID, <strong>email</strong>,{" "}
            <strong>name</strong> and <strong>profile picture</strong> link. We
            do not get your Google password, contacts or anything else. [To run
            your account: contract.]
          </li>
          <li>
            We add: a display name (&quot;handle&quot;) you can choose, an
            optional public username, a friend code, your profile visibility
            setting, when you joined and last signed in, and the{" "}
            <strong>country</strong> your first sign-in came from (just the
            country, worked out from your IP address by our host, never your
            city or location). [To run your account: contract. Country: our
            legitimate interest in knowing roughly where players are from.]
          </li>
          <li>
            Your activity: scores, favourites, plays (for your profile and
            &quot;friends who play this&quot;), achievements, daily streak (with
            your device&apos;s time zone offset, so reminders arrive at a
            sensible time), friends and blocks, challenges and invites,
            notification settings, and reviews you write. [To provide the
            features: contract.]
          </li>
          <li>
            If you turn on push notifications: a push address and keys for each
            device (up to 10). No device name or IP address is stored with it.
            [Consent: you tick the browser prompt, and can withdraw it at any
            time in your browser or your notification settings.]
          </li>
          <li>
            Survey answers, if you answer one. They are linked to your account
            inside our database so that you can only answer once, but reports
            to our team show answers without your name or email. [Legitimate
            interests: improving the site.]
          </li>
        </ul>
        <p>
          <strong>If you are in the beta testing programme</strong> (invite
          only) see section 8.
        </p>
        <p>
          We do not use your data to make automated decisions about you, and we
          do not build advertising profiles.
        </p>
      </LegalSection>

      <LegalSection id="shown" title="4. What other players can see">
        <ul>
          <li>
            <strong>Never shown to other players:</strong> your email, your real
            Google name, your Google account ID, your IP address.
          </li>
          <li>
            <strong>Your display name</strong> (your handle, or your @username,
            or a generic name) appears on leaderboards, reviews, friends lists,
            challenge links and invites.
          </li>
          <li>
            <strong>Your profile picture is the Google picture, and it is often
            a real photo.</strong> It appears next to your signed-in
            leaderboard scores, your reviews, and to friends and on your
            profile if your visibility setting allows. We deliberately leave it
            off challenge pages, invite pages and online co-op rooms.{" "}
            <Placeholder>OWNER TO CONFIRM: is showing the picture on public
            leaderboards and reviews intended?</Placeholder>
          </li>
          <li>
            <strong>Profile visibility</strong> starts at &quot;friends&quot;:
            people who are not your friends see only your name and picture.
            You can change it to public or private. Profile pages are marked so
            search engines should not list them.
          </li>
          <li>
            <strong>Challenge links and invite links</strong> show your display
            name and a score or game to anyone who gets the link. Anyone can
            open them, so only share them with people you trust. Invite links
            expire after a short time (30 minutes by default).
          </li>
          <li>
            Reviews are public. Leaderboards are readable by other websites
            too.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="storage" title="5. Cookies, local storage and the service worker">
        <p>
          UK rules (PECR) say we must tell you about, and sometimes ask
          permission for, anything we store on your device or read from it.
        </p>
        <ul>
          <li>
            <strong>Sign-in cookie.</strong> If you sign in, our sign-in system
            sets a session cookie to keep you signed in (about 30 days). Needed
            for the service you asked for, so no permission is needed.
          </li>
          <li>
            <strong>Settings and features, stored in your browser</strong>{" "}
            (local storage, session storage and a small database): favourites,
            recent games, streak, theme, tab-disguise, catalogue sort and view,
            closed banners, a guest leaderboard name, and notification
            preferences. Strictly for features you use.
          </li>
          <li>
            <strong>Service worker.</strong> HALLPASS can be installed like an
            app and works offline. A service worker saves copies of public
            pages and games on your device. It is set up not to save pages that
            show your account, friends or profile.
          </li>
          <li>
            <strong>Analytics</strong> may also store an anonymous ID and which
            link brought you here, in a cookie and local storage. See below.{" "}
            <Placeholder>CONFIRM the exact PostHog storage settings at
            runtime</Placeholder>
          </li>
        </ul>
        <p>
          You can clear all of this in your browser settings at any time. Some
          features will then reset.
        </p>
      </LegalSection>

      <LegalSection id="analytics" title="6. Analytics">
        <p>
          We use <strong>PostHog</strong> (servers in the EU) to see which pages
          and games are used, how people find us, and what breaks. It records
          page views, clicks, the games you start and stop, what you type in the
          game search box, favourites, whether you use a challenge or invite
          link, your device&apos;s daily-play streak, and website errors.
        </p>
        <ul>
          <li>
            We send these through our own address (/ingest) so they go through
            HALLPASS first. We do not link them to your account: the site never
            tells PostHog who you are, so the data is about a browser, not a
            named person. On a shared school computer, that browser may be used
            by many people.
          </li>
          <li>
            We do not use PostHog for advertising and we do not sell or share
            this data with advertisers.
          </li>
          <li>
            We do not switch on session recording or screen replay of ordinary
            visitors. <Placeholder>CONFIRM in PostHog project settings: the
            code does not set this, so it must be checked</Placeholder>
          </li>
          <li>
            There is currently no cookie banner or switch to turn analytics
            off. If you do not want it, use your browser&apos;s tracker or
            content blocker, or tell us at{" "}
            smartlizardpy@duck.com and we will act on your
            request. <Placeholder>SOLICITOR: PECR consent / statistical
            exemption position; an opt-out control may be needed</Placeholder>
          </li>
        </ul>
        <p>
          We do not use Google Analytics, advertising pixels or social media
          trackers. Trailers load from YouTube (privacy-enhanced mode) only
          after you press play on one. The site shows a small number of
          advertising links; they are plain links, and clicking one is counted
          in our analytics.
        </p>
      </LegalSection>

      <LegalSection id="coop" title="7. Online co-op and your IP address">
        <p>
          Some games let you play with someone else online. This connects your
          device <strong>directly to theirs</strong> (called peer-to-peer, or
          WebRTC). To do that, devices must learn each other&apos;s network
          addresses. <strong>That means the other players in your room may be
          able to see your IP address</strong>, which can show roughly where you
          are and who your internet provider is.
        </p>
        <ul>
          <li>
            Rooms are private. You join with a short code, so only people you
            share the code with should be able to join. Do not share the code
            with strangers.
          </li>
          <li>
            Other players see your display name, not your Google name or email.
            We do not send your profile picture to them.
          </li>
          <li>
            To set the connection up we use our database to pass short setup
            messages (these contain network addresses) between devices. They
            are deleted within minutes. Rooms disappear about three minutes
            after the host goes quiet. We store a hash of your player ID or IP
            address, not the address itself, to limit abuse.
          </li>
          <li>
            Your browser asks free &quot;STUN&quot; servers run by Cloudflare
            and Google what your public address is. If a direct link is not
            possible, traffic goes through a &quot;relay&quot; (TURN) server
            instead <Placeholder>CONFIRM which TURN provider is live in
            production (the code supports Cloudflare Realtime TURN)</Placeholder>
            . Those providers will see your IP address.
          </li>
          <li>
            Game data goes directly between players and does not pass through
            our servers (unless a relay is used, which only forwards it). We do
            not record it. Games can use your microphone for voice only if the
            game asks and your browser permission prompt is accepted; you can
            mute. <Placeholder>CONFIRM whether any live game uses
            voice</Placeholder>
          </li>
        </ul>
        <p>
          If you do not want other players to see your IP address, do not use
          online co-op.
        </p>
      </LegalSection>

      <LegalSection id="beta" title="8. Beta testing programme">
        <p>
          A small invite-only group of testers try unreleased games and report
          bugs. If you are one of them:
        </p>
        <ul>
          <li>
            A bug report can include what you typed, a rating, your browser and
            device description, the game&apos;s error messages, and a
            screenshot or a short clip of the game.
          </li>
          <li>
            Clips and screenshots are only taken when you press a button. The
            browser asks you to choose what to share, and we only keep the game
            window, not your whole screen. We do not record your microphone or
            camera. A separate &quot;record gameplay&quot; button saves a video
            to your own device only; nothing is uploaded.
          </li>
          <li>
            A clip can show a child playing, so it is treated carefully: it is
            only played back to you and to our team, and the page is not listed
            by search engines. Files are stored with a hosting provider
            (Vercel) at a hard-to-guess address. Our team may use software
            tools, including AI assistants, to read bug reports so they can fix
            them.
          </li>
          <li>
            You earn XP for useful reports. Your rank is shown to you. After you
            finish testing a game, your display name may be shown as
            &quot;Tested by&quot; on that game&apos;s public page.
          </li>
          <li>
            We delete clips and screenshots when a bug is marked fixed. If a
            report is not resolved we do not yet delete it on a timer.{" "}
            <Placeholder>OWNER: set and state a retention period for
            unresolved reports, clips and screenshots</Placeholder>
          </li>
        </ul>
        <p>
          <Placeholder>SOLICITOR: parental permission and age rules for
          under-18 testers; the code has no age or consent step</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="sharing" title="9. Who we share data with">
        <p>We do not sell personal data. These companies help us run HALLPASS:</p>
        <ul>
          <li>
            <strong>Vercel</strong> (hosting, and file storage for game files
            and beta clips). <Placeholder>region</Placeholder>
          </li>
          <li>
            <strong>Neon</strong> (our database).{" "}
            <Placeholder>region</Placeholder>
          </li>
          <li>
            <strong>PostHog</strong> (analytics, EU).
          </li>
          <li>
            <strong>Google</strong> (sign-in; it also hosts the profile picture
            we show, and runs a STUN server and the optional review
            translation described below).
          </li>
          <li>
            <strong>Cloudflare</strong> (co-op connection helper servers).
          </li>
          <li>
            <strong>Push services</strong> run by your browser&apos;s maker
            (Apple, Google, Microsoft or Mozilla) if you turn on notifications.
            They deliver our message; it is short and does not include your
            email.
          </li>
          <li>
            <strong>GitHub</strong> runs our scheduled job that triggers streak
            reminders. It does not receive player data.
          </li>
        </ul>
        <p>
          If you press &quot;translate&quot; on a review, the text of that
          review (not who wrote it) is sent to Google&apos;s translation
          service.
        </p>
        <p>
          We may also share data if the law requires it, or to protect someone
          from serious harm.
        </p>
        <p>
          <strong>International transfers.</strong> Some of these companies are
          based in or process data in the USA or elsewhere outside the UK. Where
          that happens we rely on the safeguards UK law allows, such as the UK
          extension to the EU-US Data Privacy Framework or standard contract
          terms. <Placeholder>SOLICITOR: confirm transfer mechanism for each
          provider</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="keep" title="10. How long we keep things">
        <ul>
          <li>
            <strong>Your account</strong> until you delete it. Deleting removes
            your profile, friends, reviews, favourites, achievements, streak,
            push devices, notifications, challenges and invites.
          </li>
          <li>
            <strong>Scores</strong> stay on leaderboards after you delete your
            account, but with your name replaced by &quot;Deleted&quot; and no
            link to you.
          </li>
          <li>
            <strong>Bug reports and survey answers</strong> you made stay but
            are cut loose from your account when you delete it.
          </li>
          <li>
            <strong>Invite links</strong>: removed about an hour after they
            expire. <strong>Co-op setup messages</strong>: minutes.{" "}
            <strong>Notifications</strong>: your latest 100.
          </li>
          <li>
            <strong>Analytics</strong>: kept by PostHog for{" "}
            <Placeholder>PostHog retention setting</Placeholder>. Deleting your
            account does not delete analytics, which are not tied to you; ask
            us if you want us to look into removing a browser&apos;s data.
          </li>
          <li>
            <strong>Beta clips and screenshots</strong>: see section 8.
            <Placeholder>Not all files are yet deleted automatically when an
            account is deleted: CONFIRM</Placeholder>
          </li>
          <li>
            <strong>Challenge links</strong> do not expire on their own. You can
            switch yours off.
          </li>
          <li>
            Some small records (such as who blocked whom, or a review ban) are
            kept after deletion to keep other people safe.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="rights" title="11. Your rights">
        <p>Under UK data protection law you can ask to:</p>
        <ul>
          <li>see the personal data we hold about you;</li>
          <li>correct it (you can change your handle and username in settings);</li>
          <li>
            delete it (use <strong>Delete account</strong> in your settings,
            under <Link href="/play/you/settings">Your account</Link>, or ask
            us);
          </li>
          <li>restrict or object to our use of it;</li>
          <li>
            take a copy in a usable form (we do not yet have a download
            button, so ask us);
          </li>
          <li>withdraw consent (for example, push notifications) at any time.</li>
        </ul>
        <p>
          Email smartlizardpy@duck.com. We may need to check
          it is really you. We will reply within one month. It is free. A
          parent or carer can make a request for a child.
        </p>
        <p>
          If you are unhappy with how we handle your data, please tell us first.
          You can also complain to the Information Commissioner&apos;s Office
          (ico.org.uk, 0303 123 1113). If you live in the EU or elsewhere you may
          have extra rights and can contact your own regulator.
        </p>
      </LegalSection>

      <LegalSection id="security" title="12. Keeping data safe">
        <p>
          We use encrypted connections, keep email addresses and Google names
          out of anything public, give other players a random ID instead of your
          Google account ID, store only hashed IP addresses, and limit who on our
          team can see reports. No system is perfectly safe. If something goes
          wrong that puts you at risk, we will tell you and the ICO as the law
          requires.
        </p>
      </LegalSection>

      <LegalSection id="changes" title="13. Changes">
        <p>
          We will update this page when we change what we do, and change the
          date at the top. For big changes, we will try to tell players
          on the site.
        </p>
        <p>
          Also see our <Link href="/terms">Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
