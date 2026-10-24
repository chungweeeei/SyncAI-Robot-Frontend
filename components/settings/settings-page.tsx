"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";

type SettingsParent = { href: string; label: string };

/**
 * The frame every Settings screen sits in, the landing included, so moving
 * between them never moves the title or the top-right controls: the frame is
 * one width on every screen, header and content alike.
 *
 * `parents` is the way up, nearest last. A section shows them over its title
 * and a Go back to the nearest in the top-right corner, ahead of its own
 * `action`; the landing passes none and has only its action there. Go back is
 * a link rather than history.back(), since a bookmarked section has nothing
 * behind it, and its label does not name the target — the line over the title
 * does, and its accessible name says it too.
 *
 * The content takes the frame's whole width too, a form included: a column
 * narrower than its header leaves the top-right controls hanging past the
 * edge of what they act on.
 */
export function SettingsPage({
  title,
  description,
  parents = [{ href: "/settings", label: "Settings" }],
  action,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  parents?: SettingsParent[];
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const back = parents.at(-1);

  return (
    // Settings is the one screen that scrolls; the shell's <main> does not.
    <div className="h-full overflow-y-auto">
      {/* /tasks' and /history's width. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          {parents.length ? (
            <p className="instrument-label mb-2 text-muted-foreground">
              {parents.map(({ label }) => label).join(" · ")}
            </p>
          ) : null}
          {/* The controls ride the title's row, not the line over it. */}
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
              {description ? (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              ) : null}
            </div>
            {back || action ? (
              <div className="flex shrink-0 items-start gap-2">
                {back ? (
                  <Link
                    href={back.href}
                    aria-label={`Go back to ${back.label}`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    <ArrowLeftIcon data-icon="inline-start" aria-hidden />
                    Go back
                  </Link>
                ) : null}
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
