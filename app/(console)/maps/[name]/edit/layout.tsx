import type { Metadata } from "next";

import { pageTitle } from "@/lib/page-title";

// The map's name leads the title: two editors open on two maps are the tabs
// most easily confused. The page is a client component, hence this layout.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ name: string }>;
}): Promise<Metadata> {
  const { name } = await params;
  // The name rule (lib/map/name.ts) admits nothing a URL encodes.
  return { title: pageTitle(`${name} · Map editor`) };
}

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
