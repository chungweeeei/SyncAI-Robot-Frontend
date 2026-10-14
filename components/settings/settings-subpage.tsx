"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The frame every settings section sits in: the index's scroll and one way
 * back up — a link, not history.back(), since a bookmarked section has
 * nothing behind it.
 *
 * `wide` is for a grid page (Wi-Fi's saved networks); every other section is
 * one form, so the column narrows to a reading width and centres. With an
 * `action`, the way back becomes an outline Go back beside it, so the header's
 * buttons are one row.
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
      <div
        className={cn(
          "mx-auto w-full px-4 py-4 sm:py-8",
          wide ? "max-w-6xl" : "max-w-2xl",
        )}
      >
        <header className="mb-6">
          {action ? null : (
            <Link
              href={back.href}
              className="mb-2 inline-flex items-center gap-1 rounded-md text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:min-h-10"
            >
              <ArrowLeftIcon className="size-4" aria-hidden />
              {back.label}
            </Link>
          )}
          <div className="flex items-center justify-between gap-4">
            <h1 className="min-w-0 text-xl font-semibold tracking-tight">{title}</h1>
            {action ? (
              <div className="flex shrink-0 items-center gap-2">
                <Link
                  href={back.href}
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  <ArrowLeftIcon data-icon="inline-start" aria-hidden />
                  Go back
                </Link>
                {action}
              </div>
            ) : null}
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
