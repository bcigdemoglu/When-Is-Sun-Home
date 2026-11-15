import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Places harness",
  robots: { index: false, follow: false },
};

export default function DevPlacesLayout({ children }: { children: ReactNode }) {
  return children;
}
