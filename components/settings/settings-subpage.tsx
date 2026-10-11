"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

/**
 * The frame every settings section sits in: the index's width and scroll, so
 * walking in and out does not move the header, and one way back up.
 *
 * The way back is a link to /settings rather than history.back(): a section
 * opened straight from a bookmark has no Settings behind it.
 */
export function SettingsSubpage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <Link
            href="/settings"
            className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            Settings
          </Link>
          <h1 className="mt-2 text-xl font-semibold tracking-tight">{title}</h1>
        </header>
        {/* The forms keep a reading width inside the index's wider column. */}
        <div className="max-w-2xl">{children}</div>
      </div>
    </div>
  );
}
