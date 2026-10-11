/**
 * `/terms` — the Terms of Service.
 *
 * DRAFT by a non-lawyer, written from what the product does. Facts it rests on:
 *
 *  - Accounts are Google-only and optional: `app/lib/auth.ts`; the FAQ line "no
 *    account is needed to play" in `app/lib/faq.ts`. Deletion is self-service:
 *    `app/play/account/actions.ts`, `deletePlayer` in `app/lib/players.ts`.
 *  - No age gate exists in the code (searched), so the age rule here is a
 *    contractual statement, not an enforced control. Said plainly in the text and
 *    flagged in the Privacy Policy.
 *  - Conduct surfaces: friends and blocks (`app/lib/social/*`), invites and
 *    challenges (`app/lib/invites/*`, `app/lib/challenges/*`), co-op rooms
 *    (`app/lib/p2p/*`), reviews with a report button and auto-hide at three
 *    reporters (`app/lib/reviews/config.ts`), handles and usernames
 *    (`app/lib/handle.ts`, `app/lib/username.ts`). There is NO way to report a
 *    player or a profile in the code; the text offers email instead.
 *  - Games: self-hosted games (`public/games/*`, uploads via
 *    `app/lib/game-upload.ts`), external games embedded from other origins
 *    (`app/lib/external-games-store.ts`), "By <name>" credits from
 *    `app/lib/game-credits.ts`. No takedown mechanism or licence statement exists
 *    in the code; the takedown section is new text with a placeholder address.
 *  - Beta programme: `app/lib/beta/*` (invite only, XP, rank), `/beta/closed`.
 *  - Ads strip (placeholder ad plus a partner): `app/components/Arcade.tsx`.
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

const title = "Terms of Service";
const description =
  "The rules for using HALLPASS: who can use it, how to behave, and what we promise.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/terms" },
  openGraph: { type: "website", title, description, url: "/terms" },
};

export default function TermsPage() {
  return (
    <LegalPage
      title={title}
      updated={<>11 October 2026 (draft)</>}
      shortVersion={
        <ul>
          <li>HALLPASS is a free arcade of browser games. Play as a guest or sign in.</li>
          <li>You need to be 13 or over for an account. If you are under 18, check with a parent or carer that they are happy for you to use the site.</li>
          <li>Be kind. No bullying, cheating, hate, sharing other people&apos;s private details, or trying to break the site.</li>
          <li>Keep your own stuff yours. You own what you write; you let us show it on the site.</li>
          <li>Games have authors and we credit them. Own something we host and want it gone? Tell us.</li>
          <li>We do our best, but the site is provided &quot;as is&quot; and games can break. Nothing here takes away your legal rights.</li>
          <li>You can delete your account whenever you like. We can remove accounts that break the rules.</li>
        </ul>
      }
    >
      <LegalSection id="about" title="1. About these terms">
        <p>
          These terms are an agreement between you and the operator of HALLPASS:{" "}
          Ozan Kaygusuz,{" "}
          <Placeholder>POSTAL ADDRESS</Placeholder>, contact{" "}
          smartlizardpy@duck.com (&quot;we&quot;). By using
          the site you agree to them. If you do not agree, please do not use
          it. Our <Link href="/privacy">Privacy Policy</Link> explains how we
          use your data and is part of the picture too.
        </p>
      </LegalSection>

      <LegalSection id="age" title="2. Who can use HALLPASS">
        <ul>
          <li>
            <strong>Accounts are for people aged 13 or over.</strong> You sign
            in with a Google account, which has its own rules.
          </li>
          <li>
            <strong>If you are under 13</strong>, please get a parent or
            carer&apos;s permission before using the site, and do not create an
            account.
          </li>
          <li>
            <strong>If you are under 18</strong>, please make sure a parent or
            carer knows you use HALLPASS and is happy for you to agree to these
            terms. A parent or carer who lets a child use HALLPASS is
            responsible for that child&apos;s use, and can contact us about it
            at any time.
          </li>
          <li>
            We do not currently check ages. We rely on you telling the truth.
            If we find out someone is younger than they should be, we may
            remove their account.
          </li>
        </ul>
        <p>
          <Placeholder>SOLICITOR: capacity of minors to contract; whether the
          wording should be a licence rather than a contract for under-18s
          </Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="accounts" title="3. Your account">
        <ul>
          <li>You do not need an account to play most games.</li>
          <li>
            An account lets you put scores under your name, keep streaks, make
            friends, write reviews and get notifications.
          </li>
          <li>Keep your Google account secure. What happens under it is your responsibility.</li>
          <li>
            Pick a display name and username that are fine for a school
            playground. We may change or remove names that are rude, that
            pretend to be someone else, or that include personal details.
          </li>
          <li>
            You can delete your account any time in your settings. Your scores
            stay on leaderboards, but without your name. See the Privacy
            Policy.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="conduct" title="4. How to behave">
        <p>This applies to everything: scores, names, reviews, friend requests, challenge links, invites and online co-op. Do not:</p>
        <ul>
          <li>bully, threaten, harass or pressure anyone, or be hateful about who they are;</li>
          <li>share your own or other people&apos;s private details, such as full names, addresses, phone numbers, school names or social accounts, or ask other players for theirs;</li>
          <li>send sexual or violent content, or anything illegal;</li>
          <li>pretend to be someone else, including staff;</li>
          <li>cheat, fake scores, use bots, or try to exploit bugs for unfair advantage;</li>
          <li>spam, advertise, or send people to other sites in reviews, names or invites;</li>
          <li>try to hack, overload, scrape, reverse-engineer or break the site, its security or its limits, or get into someone else&apos;s account;</li>
          <li>use the site to do anything that breaks the law or your school&apos;s rules about devices.</li>
        </ul>
        <p>
          <strong>Online co-op:</strong> other players may be able to see your
          IP address (see the Privacy Policy). Only join rooms with people you
          are comfortable with. Never share a room code with strangers, and
          never ask for another player&apos;s IP address or personal details.
        </p>
        <p>
          <strong>If something is wrong:</strong> you can block another player,
          and report a review with its report button. To report anything else
          about a person, profile, name or leaderboard entry, or anything that
          worries you, email smartlizardpy@duck.com.
          Reviews that several people report are hidden automatically. If you
          are in danger or someone else is, tell a trusted adult or the police
          first.
        </p>
        <p>
          We may remove content, hide scores, limit features or end accounts
          that break these rules. We will try to explain, but may act quickly
          where safety is at risk.{" "}
          <Placeholder>SOLICITOR: Online Safety Act duties (illegal content,
          children&apos;s risk assessment, reporting and complaints routes) for
          the friends, invites, reviews and co-op features</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="content" title="5. What you write (your content)">
        <p>
          You keep ownership of what you create, such as reviews, display names,
          survey answers, bug reports and screenshots. By posting it on
          HALLPASS you give us a free, worldwide permission to store, show,
          translate on request, and copy it as needed to run the site, show it
          to the people it is meant for, and (for a well-made bug-report
          screenshot you choose to send to the gallery) show it on the game&apos;s
          page. We do not claim anything beyond that. This permission ends when
          you delete the content or your account, except for copies we are
          required to keep or that are already in backups for a short time.
        </p>
        <p>
          Only post things you have the right to share. Do not post other
          people&apos;s photos or work.
        </p>
      </LegalSection>

      <LegalSection id="games" title="6. Games, authors and ownership">
        <ul>
          <li>
            HALLPASS is mostly games made by the team and contributors, and some
            games from other people which we host or embed from their own
            sites. Each game belongs to its author or rights holder. We credit
            the author on the game&apos;s page where we know who they are.
          </li>
          <li>
            Games you play from another website are run by that website. Their
            own terms and privacy practices apply to them, and we do not control
            what they do.
          </li>
          <li>
            We give you a personal, non-commercial permission to play the games
            on HALLPASS. You may not copy, sell, re-upload or take apart the
            games, or the site&apos;s design, name and logo, except as the law
            allows.
          </li>
          <li>
            The HALLPASS name, logo and the site&apos;s own code, art and text
            belong to us or our contributors.{" "}
            <Placeholder>OWNER: licence/ownership wording for contributed
            games</Placeholder>
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="takedown" title="7. Think we are using your work? Tell us">
        <p>
          If you own something on HALLPASS (a game, art, music or text) and you
          did not agree to it being here, or you think a game is credited
          wrongly, email smartlizardpy@duck.com{" "}
          with:
        </p>
        <ul>
          <li>your name and how to reach you;</li>
          <li>what the work is, and where you made or published it;</li>
          <li>the page address on HALLPASS where it appears;</li>
          <li>a sentence saying you believe in good faith that it is here without permission, and that what you say is accurate and you are the owner or authorised to act for them.</li>
        </ul>
        <p>
          We will look at it quickly and may remove or disable the content while
          we do. If you posted something that was taken down and you think that
          was a mistake, tell us and we will review it.{" "}
          <Placeholder>SOLICITOR: UK hosting defence process; whether a US
          DMCA designated agent registration is wanted</Placeholder>
        </p>
      </LegalSection>

      <LegalSection id="beta" title="8. Beta testing programme">
        <ul>
          <li>It is invite-only and can end at any time. We pick testers by hand.</li>
          <li>
            Testers get early access to unreleased games, which they should not
            share, record to post publicly, or describe outside HALLPASS.
          </li>
          <li>
            Reports must be honest and your own. XP and ranks are for fun, have
            no cash value, can be adjusted if we spot abuse, and are not a
            promise of any reward.
          </li>
          <li>
            Screenshots and short clips are only taken when you press the
            button, and are used to fix bugs, as the Privacy Policy explains.
            Do not capture or send anything private.
          </li>
          <li>
            Under-18 testers need a parent or carer&apos;s permission.{" "}
            <Placeholder>OWNER: how permission is obtained; the code has no
            such step today</Placeholder>
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="service" title="9. The service, adverts and changes">
        <p>
          HALLPASS is free. We may add, change, pause or remove games and
          features (including leaderboards, notifications and co-op), and we
          may remove old scores. Games that run on your device may work offline
          once you have visited. The site may show links to adverts or
          partners; we are not responsible for other sites you visit from them.
          We do not promise the site will always be available or error-free.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="10. What we promise, and what we do not">
        <p>
          We take reasonable care in running HALLPASS, but it is provided free,
          &quot;as is&quot;, and we cannot promise that every game is bug-free,
          that scores or streaks will never be lost, or that other websites we
          link to are safe.
        </p>
        <p>
          Nothing in these terms limits anything the law does not allow us to
          limit. That includes liability for death or personal injury caused by
          our negligence, for fraud or fraudulent misrepresentation, and any
          rights you have as a consumer (including that digital content should
          be as described and of satisfactory quality, and that unfair terms
          do not bind you).
        </p>
        <p>
          Subject to that, and to the extent the law allows, we are not
          responsible for losses that were not a reasonably foreseeable result
          of our breach, for what other users or other websites do, or for
          losses to a business, because HALLPASS is meant for personal use. Our
          total responsibility to you for anything connected with the site is
          limited to <Placeholder>SOLICITOR: appropriate cap, if any, for a free
          consumer service</Placeholder>.
        </p>
      </LegalSection>

      <LegalSection id="ending" title="11. Ending things">
        <p>
          You can stop using HALLPASS or delete your account at any time. We may
          suspend or end your access if you break these terms, put others at
          risk, or if the law requires. Sections that by their nature should
          continue (like ownership and takedowns) do.
        </p>
      </LegalSection>

      <LegalSection id="law" title="12. Law, complaints and changes">
        <p>
          These terms are governed by the law of England and Wales, and the
          courts of England and Wales can hear disputes, but if you live
          elsewhere in the UK you may also use your local courts, and nothing
          removes any protection that the law where you live gives you as a
          consumer.
        </p>
        <p>
          If something is wrong, please talk to us first at{" "}
          smartlizardpy@duck.com.
        </p>
        <p>
          We may update these terms, for example when we add features or the
          law changes. We will change the date at the top and try to tell players
          on the site when the change matters. If you carry on using HALLPASS
          after a change you accept it; if you do not, you can delete your
          account.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
