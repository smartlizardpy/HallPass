import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Nunito } from "next/font/google";
import { FeaturePromo } from "./components/FeaturePromo";
import { MobileSplash } from "./components/MobileSplash";
import { MobileTabBar } from "./components/MobileTabBar";
import { PWA } from "./components/PWA";
import { StealthController } from "./components/stealth/StealthController";
import { StreakToast } from "./components/streak/StreakToast";
import { WelcomeToast } from "./components/WelcomeToast";
import { cloakBootScript } from "./lib/stealth/boot";
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
        {/* Applies a saved tab cloak during head parse, before first paint, so a
            disguised tab never flashes "HALLPASS" on a cold load. */}
        <Script id="hp-cloak-boot" strategy="beforeInteractive">
          {cloakBootScript()}
        </Script>
        {children}
        <WelcomeToast />
        <PWA />
        <FeaturePromo />
        <MobileTabBar />
        <MobileSplash />
        <StealthController />
        <StreakToast />
      </body>
    </html>
  );
}
