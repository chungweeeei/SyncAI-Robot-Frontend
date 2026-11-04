import type { Metadata } from "next";

import { pageTitle } from "@/lib/page-title";

// The page is a client component and cannot export metadata, so its tab
// title lives in this pass-through layout.
export const metadata: Metadata = { title: pageTitle("WebRTC test") };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
