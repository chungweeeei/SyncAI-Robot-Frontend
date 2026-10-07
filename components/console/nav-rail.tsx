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

// /webrtc-test is intentionally absent: it is a developer tool, not an operator
// screen. Open it by hand. (See its page comment.)
const navItems = [
  { title: "Dashboard", href: "/", icon: RadarIcon },
  // Between the driving screen and the map library, which is the mapping
  // workflow's own order: drive, build, then manage what was saved.
  { title: "Mapping", href: "/mapping", icon: CompassIcon },
  { title: "Maps", href: "/maps", icon: MapIcon },
  // With Maps rather than next to Mapping: both are libraries of what the robot
  // has kept, and the operator reaches for a bag the way they reach for a map —
  // afterwards, by name. Its place in the workflow is upstream of both, but a
  // rail is a list of screens, not a sequence.
  { title: "Recordings", href: "/recordings", icon: CircleDotIcon },
  { title: "Tasks", href: "/tasks", icon: ListChecksIcon },
  // Straight after Tasks: it is what a task becomes once it ends, and the two
  // are read together — start a job there, see how it went here.
  { title: "History", href: "/history", icon: HistoryIcon },
  { title: "Settings", href: "/settings", icon: SlidersHorizontalIcon },
];

/**
 * The console's sections: a rail on desktop and a bottom bar on narrow screens.
 *
 * From lg up the rail opens labelled — an icon and its screen's name per row,
 * 192 px wide — and its top-left corner is one button that folds it to the 56 px
 * icon rail: icons only, with no hover tooltip, by request — a folded rail is
 * the operator asking for less on screen, and the open one is a click away
 * when a name is wanted. aria-label still names every icon. Labelled by
 * default, by request: seven icons read as seven guesses until an operator
 * has learnt them, and the fold is there for the screens that want the
 * width back for the map. It is still not the shadcn sidebar this replaced —
 * no drawer, no sheet, no second trigger elsewhere — only the one rail at two
 * widths.
 *
 * The fold is instant, not animated: the rail's width is the viewport's, and
 * a width that eased over 200 ms resized both map canvases on every frame of
 * it, each resize a reallocation of their drawing surface.
 *
 * The fold is this rail's own state, not remembered: the rail is mounted once
 * in the layout, so it holds across navigation, and a reload opens labelled
 * again. Remembering it across reloads would be browser storage, which has
 * one home (lib/task/draft-store.ts); it goes there if it is ever wanted.
 * Below lg there is nothing to fold, so the toggle is not rendered there.
 */
export function NavRail() {
  const pathname = usePathname();
  const [expanded, setExpanded] = React.useState(true);

  return (
    <nav
      aria-label="Console sections"
      className={cn(
        "flex shrink-0 items-center border-hairline bg-panel",
        // Mobile: a bottom bar, below the viewport it must not cover. The
        // height carries the home-indicator inset and the padding pays it
        // back, so the 56 px content box — and the tick measured from it —
        // is the same on a notched phone and a bare one.
        "order-last h-[calc(3.5rem+env(safe-area-inset-bottom))] flex-row gap-1 border-t px-2 pb-[env(safe-area-inset-bottom)]",
        // Desktop: the rail. Items keep a 10 px margin at either width, which
        // is what lands the location tick (-9px) on the rail's edge.
        "lg:order-first lg:h-auto lg:flex-col lg:justify-start lg:gap-1 lg:border-t-0 lg:border-r lg:px-2.5 lg:py-3",
        expanded ? "lg:w-48 lg:items-stretch" : "lg:w-14",
      )}
    >
      {/* The rail's head is the fold alone, by request, in the top-left
        * corner at either width — where the console's mark used to stand.
        * Dashboard is the first row right under it, so the mark's other job,
        * a way home, is not lost. */}
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
        // Prefix match, so /maps/<name>/edit keeps the Maps tick lit. "/" has to
        // be exact or it would match every route.
        const active =
          item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            // Named explicitly, because the visible text is not always
            // there: a folded rail is icons only — no hover tooltip
            // either, by request; the open rail is how a name is read.
            // Where the label is drawn it is the same words, so the
            // accessible name and the visible one never diverge.
            aria-label={item.title}
            aria-current={active ? "page" : undefined}
            className={cn(
              // flex-1 and no padding below lg: seven equal tabs are
              // what fit 375 px at a 40 px target, and padding only
              // ever pushed the last tabs past the edge of a body
              // that cannot scroll to them.
              "relative flex h-10 min-w-0 flex-1 items-center justify-center gap-2 rounded-sm transition-colors lg:h-9 lg:flex-none",
              expanded ? "lg:w-full lg:justify-start lg:gap-3 lg:px-[9px]" : "lg:w-9",
              active
                ? "bg-elevated text-foreground"
                : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground",
            )}
          >
            <item.icon className="size-[18px] shrink-0" />
            {/* The bottom bar's tabs are labelled from md, where a
              * seventh of the width holds one.
              * Below that the icon alone is the tab, and aria-label
              * above still names it. From lg the open rail labels
              * every row and the folded one none. */}
            <span
              className={cn(
                "instrument-label hidden truncate md:inline",
                !expanded && "lg:hidden",
              )}
            >
              {item.title}
            </span>
            {/* Location marker: a commanded-hue tick on the panel edge
             * the rail is attached to. */}
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
