import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Pinch-zoom stays enabled: people need it to read small print.
// `viewport-fit=cover` lets the map run under the notch and the home
// indicator; everything else keeps clear with env(safe-area-inset-*).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f0e6" },
    { media: "(prefers-color-scheme: dark)", color: "#12110e" },
  ],
};

const DESCRIPTION =
  "See how many hours of direct sunlight a backyard, terrace or window gets on every day of the year, with the shade of nearby buildings taken into account.";

export const metadata: Metadata = {
  title: "When is Sun Home?",
  description: DESCRIPTION,
  metadataBase: new URL("https://when-is-sun-home.vercel.app"),
  applicationName: "Sun Home",
  // Added to the home screen, it opens like an app: no browser chrome.
  appleWebApp: { capable: true, title: "Sun Home", statusBarStyle: "default" },
  formatDetection: { telephone: false, address: false },
  openGraph: {
    title: "When is Sun Home?",
    description: DESCRIPTION,
    siteName: "When is Sun Home?",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "When is Sun Home?",
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* The map's style, tiles and fonts, and the address search: connect early. */}
        <link rel="preconnect" href="https://basemaps.cartocdn.com" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://tiles.basemaps.cartocdn.com" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://photon.komoot.io" />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
