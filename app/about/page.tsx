/**
 * `/about` — what HALLPASS is, in plain language.
 *
 * Every sentence rests on something the site already asserts elsewhere (the game
 * FAQ in `app/lib/faq.ts`, the creator and tester credits on game pages, the
 * legal pages' contact address). It deliberately says nothing about who runs the
 * site or which games are original: that is for the owner to write, and a page
 * that guessed would be the worst kind of trust signal. Static on purpose — no
 * session or database reads, so it prerenders.
 */

import type { Metadata } from "next";
import Link from "next/link";
import { BackButton } from "../components/BackButton";
import { Wordmark } from "../components/Wordmark";
import { LegalSection } from "../components/legal/LegalPage";

const title = "About HALLPASS";
const description =
  "HALLPASS is a free arcade of browser games: no downloads, no account needed to play, and each game's page credits its creator and playtesters.";

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/about" },
  openGraph: { type: "website", title, description, url: "/about" },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-8">
      <div className="mx-auto max-w-3xl">
        <BackButton />
        <header className="mt-6">
          <Wordmark size="text-3xl" dotClass="h-2 w-2" />
          <h1 className="mt-3 text-3xl font-black tracking-tight text-foreground">
            {title}
          </h1>
        </header>

        <LegalSection id="what" title="What it is">
          <p>
            HALLPASS is a free arcade of games that run in your browser. There is
            nothing to download and no account is needed to play; signing in only
            adds scores, streaks and friends.
          </p>
          <p>
            <Link href="/">Browse every game</Link> or start from a genre such as{" "}
            <Link href="/category/arcade">arcade</Link>,{" "}
            <Link href="/category/horror">horror</Link> or{" "}
            <Link href="/category/puzzle">puzzle</Link>.
          </p>
        </LegalSection>

        <LegalSection id="credits" title="Who made each game">
          <p>
            Each game&apos;s page names its creator, and lists the playtesters who
            tried it before it went live, so you can see who is behind what you
            are playing.
          </p>
        </LegalSection>

        <LegalSection id="policies" title="Your data">
          <p>
            What we store and why is spelled out in the{" "}
            <Link href="/privacy">Privacy Policy</Link>, the{" "}
            <Link href="/terms">Terms</Link> and the{" "}
            <Link href="/cookies">Cookies</Link> page.
          </p>
        </LegalSection>
      </div>
    </main>
  );
}
