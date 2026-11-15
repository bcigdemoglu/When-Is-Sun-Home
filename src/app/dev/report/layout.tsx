import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Sun report harness",
  robots: { index: false, follow: false },
};

export default function DevReportLayout({ children }: { children: ReactNode }) {
  return children;
}
