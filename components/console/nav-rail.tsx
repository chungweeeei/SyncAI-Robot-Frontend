"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleDotIcon,
  CompassIcon,
  HistoryIcon,
  ListChecksIcon,
  MapIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RadarIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

import { ModeToggle } from "@/components/mode-toggle";
import { cn } from "@/lib/utils";

// /webrtc-test is intentionally absent: a developer tool, opened by hand.
const navItems = [
  { title: "Dashboard", href: "/", icon: RadarIcon },
  { title: "Mapping", href: "/mapping", icon: CompassIcon },
  { title: "Maps", href: "/maps", icon: MapIcon },
  // Beside Maps: both are libraries of what the robot kept.
  { title: "Recordings", href: "/recordings", icon: CircleDotIcon },
  { title: "Tasks", href: "/tasks", icon: ListChecksIcon },
  // After Tasks: start a job there, see how it went here.
  { title: "History", href: "/history", icon: HistoryIcon },
  { title: "Settings", href: "/settings", icon: SlidersHorizontalIcon },
];

/**
 * The console's sections: a rail from lg, a bottom bar below.
 *
 * The rail opens labelled, by request (seven bare icons are seven guesses),
 * and its top-left button folds it to icons only, with no tooltip, by request.
 * The fold is instant: an eased width would resize both map canvases on every
 * frame. It is not remembered across reloads; if it ever is, it belongs in
 * lib/task/draft-store.ts, the one home for browser storage.
 */
export function NavRail() {
  const pathname = usePathname();
  const [expanded, setExpanded] = React.useState(true);

  return (
    <nav
      aria-label="Console sections"
      className={cn(
        "flex shrink-0 items-center border-hairline bg-panel",
        // Mobile: the height adds the home-indicator inset and the padding pays
        // it back, so the 56 px content box is the same on every phone.
        "order-last h-[calc(3.5rem+env(safe-area-inset-bottom))] flex-row gap-1 border-t px-2 pb-[env(safe-area-inset-bottom)]",
        // Desktop: the 10 px item margin lands the tick (-9px) on the edge.
        "lg:order-first lg:h-auto lg:flex-col lg:justify-start lg:gap-1 lg:border-t-0 lg:border-r lg:px-2.5 lg:py-3",
        expanded ? "lg:w-48 lg:items-stretch" : "lg:w-14",
      )}
    >
      {/* The rail's head is the fold alone, by request. */}
      <div className="hidden shrink-0 lg:mb-4 lg:flex">
        <button
          type="button"
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse the sidebar" : "Expand the sidebar"}
          className="flex size-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded ? (
            <PanelLeftCloseIcon aria-hidden className="size-[18px]" />
          ) : (
            <PanelLeftOpenIcon aria-hidden className="size-[18px]" />
          )}
        </button>
      </div>

      {navItems.map((item) => {
        // Prefix match keeps /maps/<name>/edit lit; "/" must be exact.
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            // Named explicitly: the visible label is not always drawn.
            aria-label={item.title}
            aria-current={active ? "page" : undefined}
            className={cn(
              // flex-1, no padding below lg: seven 40 px tabs fit 375 px.
              "relative flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm transition-colors lg:h-9 lg:flex-none",
              expanded ? "lg:w-full lg:justify-start lg:gap-3 lg:px-[9px]" : "lg:w-9",
              active
                ? "bg-elevated text-foreground"
                : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground",
            )}
          >
            <item.icon className="size-[18px] shrink-0" />
            {/* The bottom bar is labelled from md, where a seventh of the
              * width holds one. */}
            <span
              className={cn(
                "instrument-label hidden truncate md:inline",
                !expanded && "lg:hidden",
              )}
            >
              {item.title}
            </span>
            {/* Location tick on the rail's attached edge. */}
            {active && (
              <span
                aria-hidden
                className="absolute -bottom-[7px] left-1/2 h-[2px] w-5 -translate-x-1/2 rounded-full bg-signal-cmd lg:-left-[9px] lg:bottom-auto lg:h-5 lg:w-[2px] lg:translate-x-0"
              />
            )}
          </Link>
        );
      })}

      <div className={cn("shrink-0 lg:mt-auto", !expanded && "lg:self-center")}>
        <ModeToggle />
      </div>
    </nav>
  );
}
