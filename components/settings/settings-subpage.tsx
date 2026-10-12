"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The frame every settings section sits in: the index's scroll, and one way
 * back up.
 *
 * The way back is a link rather than history.back(): a section opened
 * straight from a bookmark has nothing behind it. It is /settings unless the
 * page sits one level deeper (Wi-Fi's Add network goes back to Wi-Fi).
 *
 * `wide` is for a page that lays out a grid rather than one form — Wi-Fi's
 * saved networks — and takes the index's full column. Every other section is
 * one form, so the whole column, header included, narrows to a reading width
 * and centres: a form pinned to the left of a 6xl column left most of a wide
 * screen empty on one side.
 *
 * `action` sits opposite the title, where the index keeps Restart. A page
 * with one keeps its way back beside it, as an outline Go back, so the
 * header's buttons are one row the way the task editor's are; a page without
 * one keeps the quiet link above the title.
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
