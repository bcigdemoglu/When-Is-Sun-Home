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
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f3ef" },
    { media: "(prefers-color-scheme: dark)", color: "#111110" },
  ],
};

const DESCRIPTION =
  "See how many hours of direct sunlight a backyard, terrace or window gets on every day of the year, with the shade of nearby buildings taken into account.";

export const metadata: Metadata = {
  title: "When is Sun Home?",
  description: DESCRIPTION,
  metadataBase: new URL("https://when-is-sun-home.vercel.app"),
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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
    </html>
  );
}
