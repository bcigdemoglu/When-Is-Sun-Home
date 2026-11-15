import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Share harness",
  robots: { index: false, follow: false },
};

export default function DevShareLayout({ children }: { children: ReactNode }) {
  return children;
}
