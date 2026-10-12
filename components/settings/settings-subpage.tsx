"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

/**
 * The frame every settings section sits in: the index's width and scroll, so
 * walking in and out does not move the header, and one way back up.
 *
 * The way back is a link rather than history.back(): a section opened
 * straight from a bookmark has nothing behind it. It is /settings unless the
 * page sits one level deeper (Wi-Fi's Add network goes back to Wi-Fi).
 *
 * `wide` is for a page that lays out a grid rather than one form — Wi-Fi's
 * saved networks — and takes the index's full column instead of the reading
 * width. `action` sits opposite the title, where the index keeps Restart.
 */
export function SettingsSubpage({
  title,
  back = { href: "/settings", label: "Settings" },
  action,
  wide = false,
  children,
}: {
  title: string;
  back?: { href: string; label: string };
  action?: React.ReactNode;
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <Link
            href={back.href}
            className="inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
          >
            <ArrowLeftIcon className="size-4" aria-hidden />
            {back.label}
          </Link>
          <div className="mt-2 flex items-center justify-between gap-4">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight">{title}</h1>
            {action}
          </div>
        </header>
        {/* A form keeps a reading width inside the index's wider column. */}
        <div className={wide ? undefined : "max-w-2xl"}>{children}</div>
      </div>
    </div>
  );
}
