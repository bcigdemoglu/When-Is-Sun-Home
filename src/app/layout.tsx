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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "When is Sun Home?",
  description: "Track the sun's position on an interactive map for any location and time",
  metadataBase: new URL("https://when-is-sun-home.vercel.app"),
  openGraph: {
    title: "When is Sun Home?",
    description: "Track the sun's position on an interactive map for any location and time",
    siteName: "When is Sun Home?",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "When is Sun Home?",
    description: "Track the sun's position on an interactive map for any location and time",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
