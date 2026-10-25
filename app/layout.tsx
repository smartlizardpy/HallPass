import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Nunito } from "next/font/google";
import { FeaturePromo } from "./components/FeaturePromo";
import { SurveyBanner } from "./components/SurveyBanner";
import { GrowthTracker } from "./components/GrowthTracker";
import { CoopTelemetry } from "./components/CoopTelemetry";
import { MobileSplash } from "./components/MobileSplash";
import { MobileTabBar } from "./components/MobileTabBar";
import { PWA } from "./components/PWA";
import { StealthController } from "./components/stealth/StealthController";
import { StreakBeacon } from "./components/streak/StreakBeacon";
import { StreakToast } from "./components/streak/StreakToast";
import { EventController } from "./components/events/EventController";
import { ThemeController } from "./components/theme/ThemeController";
import { OnboardingGate } from "./components/OnboardingGate";
import { WelcomeToast } from "./components/WelcomeToast";
import { AnalyticsNotice } from "./components/analytics/AnalyticsNotice";
import { cloakBootScript } from "./lib/stealth/boot";
import { eventBootScript } from "./lib/events/boot";
import { FRIGHT_FEST_THEME } from "./lib/events/fright-fest";
import { themeBootScript } from "./lib/theme/boot";
import { SITE_URL } from "./lib/site";
import "./globals.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#7c2eef",
};

const nunito = Nunito({
  variable: "--font-nunito",
  subsets: ["latin"],
  weight: ["400", "600", "700", "800", "900"],
});

const siteName = "HALLPASS";
const siteDescription =
  "A modern arcade of unblocked browser games. Neon, fast, free, and ready to play.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "HALLPASS — Unblocked Games",
    template: "%s · HALLPASS",
  },
  description: siteDescription,
  applicationName: siteName,
  keywords: [
    "unblocked games",
    "browser games",
    "free games",
    "html5 games",
    "arcade",
    "school games",
    "io games",
  ],
  authors: [
    { name: "Ozan Kaygusuz" },
    { name: "Ateş Demir" },
    { name: "Sohan Kanti Dolai" },
  ],
  creator: "Ozan Kaygusuz",
  openGraph: {
    type: "website",
    siteName,
    title: "HALLPASS — Unblocked Games",
    description: siteDescription,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "HALLPASS — Unblocked Games",
    description: siteDescription,
  },
  verification: {
    google: "_wbMr1zAWsVeBE8NrNOJ1jyw7XsBZlF2V4xgR2Urvbg",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${nunito.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Resolves the saved appearance choice during head parse, before first
            paint, so a player who chose Dark never gets a white flash on a cold
            load. It publishes `data-theme` on <html>; every token in
            `globals.css` hangs off that attribute, with the OS preference as the
            fallback for the case where this script never runs. */}
        <Script id="hp-theme-boot" strategy="beforeInteractive">
          {themeBootScript()}
        </Script>
        {/* Seasonal event skin. Runs right after the theme script so it can
            override `data-theme` before first paint. The server never reads the
            clock; see lib/events/boot.ts. Empty (and skipped) when the event is
            disabled in lib/events/fright-fest.ts. */}
        {eventBootScript(FRIGHT_FEST_THEME) && (
          <Script id="hp-event-boot" strategy="beforeInteractive">
            {eventBootScript(FRIGHT_FEST_THEME)}
          </Script>
        )}
        {/* Applies a saved tab cloak during head parse, before first paint, so a
            disguised tab never flashes "HALLPASS" on a cold load. */}
        <Script id="hp-cloak-boot" strategy="beforeInteractive">
          {cloakBootScript()}
        </Script>
        {children}
        <WelcomeToast />
        {/* Sends a player who still owes a sign-up step to /play/welcome. */}
        <OnboardingGate />
        {/* One-time note about analytics; see its header for where it hides. */}
        <AnalyticsNotice />
        <PWA />
        <FeaturePromo />
        {/* A strip for a live survey; below the promo and the game player. */}
        <SurveyBanner />
        <MobileTabBar />
        <MobileSplash />
        <StealthController />
        <StreakToast />
        <StreakBeacon />
        {/* Renders nothing — keeps `data-theme` in step with the stored choice
            and with a device whose own preference changes mid-session. */}
        <ThemeController />
        {/* Renders nothing — keeps the seasonal attributes right across soft
            navigation, choice changes and expiry. Knows nothing of the
            championship. */}
        <EventController />
        {/* Renders nothing — listens to the same streak event as the toast above
            and reports the first play of a new day. See its header for why it is
            not folded into the toast. */}
        <GrowthTracker />
        <CoopTelemetry />
      </body>
    </html>
  );
}
