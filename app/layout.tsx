import type { Metadata, Viewport } from "next";
import { Nunito } from "next/font/google";
import { PWA } from "./components/PWA";
import { WelcomeToast } from "./components/WelcomeToast";
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
  metadataBase: new URL("https://hallpass.gg"),
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
        {children}
        <WelcomeToast />
        <PWA />
      </body>
    </html>
  );
}
