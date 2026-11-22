"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleDotIcon,
  CompassIcon,
  HistoryIcon,
  ListChecksIcon,
  LogOutIcon,
  MapIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RadarIcon,
  SlidersHorizontalIcon,
  StethoscopeIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";

import { useMounted } from "@/hooks/use-mounted";
import { signOut } from "@/hooks/use-session";
import { cn } from "@/lib/utils";

const navItems = [
  { title: "Dashboard", href: "/", icon: RadarIcon },
  { title: "Mapping", href: "/mapping", icon: CompassIcon },
  { title: "Maps", href: "/maps", icon: MapIcon },
  // Beside Maps: both are libraries of what the robot kept.
  { title: "Recordings", href: "/recordings", icon: CircleDotIcon },
  { title: "Tasks", href: "/tasks", icon: ListChecksIcon },
  // After Tasks: start a job there, see how it went here.
  { title: "History", href: "/history", icon: HistoryIcon },
  // In the side rail alone: the bottom bar holds seven tabs, 40 px each on a
  // phone and labelled whole at md, and an eighth broke both. A support tool
  // that saves a file for an engineer is the one screen a laptop's is for.
  { title: "Diagnostics", href: "/diagnostics", icon: StethoscopeIcon, railOnly: true },
  { title: "Settings", href: "/settings", icon: SlidersHorizontalIcon },
];

/** Tailwind's `xl`, where the untouched rail opens labelled. */
const LABELLED_BY_DEFAULT = "(min-width: 80rem)";

/** A class set for the rail's two faces, and for the one the width picks. */
function byFold(expanded: boolean | null, open: string, folded: string, auto: string) {
  return expanded === null ? auto : expanded ? open : folded;
}

/** A rail row's two faces: the labelled row, or its 36 px icon alone. */
function rowFold(expanded: boolean | null) {
  return byFold(
    expanded,
    "lg:w-full lg:justify-start lg:gap-3 lg:px-[9px]",
    "lg:w-9",
    "lg:w-9 xl:w-full xl:justify-start xl:gap-3 xl:px-[9px]",
  );
}

const themeKeys = [
  {
    theme: "light",
    label: "Light",
    icon: SunIcon,
    // Raised unless `.dark` says otherwise.
    face: "bg-panel text-foreground ring-1 ring-hairline dark:bg-transparent dark:text-muted-foreground dark:ring-0 dark:hover:bg-elevated/60 dark:hover:text-foreground",
    alone: (expanded: boolean | null) =>
      byFold(expanded, "max-lg:hidden dark:flex", "hidden dark:flex", "max-xl:hidden dark:flex"),
  },
  {
    theme: "dark",
    label: "Dark",
    icon: MoonIcon,
    face: "text-muted-foreground hover:bg-elevated/60 hover:text-foreground dark:bg-elevated dark:text-foreground dark:ring-1 dark:ring-hairline dark:hover:bg-elevated dark:hover:text-foreground",
    alone: (expanded: boolean | null) =>
      byFold(expanded, "dark:max-lg:hidden", "dark:hidden", "dark:max-xl:hidden"),
  },
];

/**
 * Light or dark, as a two-position switch: a well holding both keys, the one
 * in force raised, so the row says which theme is on rather than only which
 * one a press would bring. Folded, and in the phone's bar, there is room for
 * one key, so the raised one goes and the press left to make is what is drawn.
 *
 * Which key is raised, and which is the one alone, is CSS on the `.dark`
 * class next-themes writes before the first paint, so the row is right from
 * the server's markup on; read from `useTheme` it waited for mount behind a
 * blank button. Only `aria-pressed` still waits. Light / dark / system is
 * Settings → Preferences: a press here always picks one of the two.
 */
function ThemeSwitch({ expanded }: { expanded: boolean | null }) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();

  return (
    <div
      role="group"
      aria-label="Theme"
      className={cn(
        "flex shrink-0",
        // The well: a step down from the rail, 36 px tall like the rows.
        byFold(
          expanded,
          "lg:w-full lg:gap-0.5 lg:rounded-md lg:bg-background lg:p-[3px]",
          "",
          "xl:w-full xl:gap-0.5 xl:rounded-md xl:bg-background xl:p-[3px]",
        ),
      )}
    >
      {themeKeys.map((key) => (
        <button
          key={key.theme}
          type="button"
          onClick={() => setTheme(key.theme)}
          // Named explicitly: the visible label is not always drawn.
          aria-label={`${key.label} theme`}
          aria-pressed={mounted ? resolvedTheme === key.theme : undefined}
          className={cn(
            // 40 px in the phone bar, 36 px in the folded rail, like the tabs.
            "flex size-10 items-center justify-center rounded-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
            key.face,
            key.alone(expanded),
            byFold(
              expanded,
              "lg:h-[30px] lg:w-auto lg:flex-1 lg:gap-1.5",
              "lg:size-9",
              "lg:size-9 xl:h-[30px] xl:w-auto xl:flex-1 xl:gap-1.5",
            ),
          )}
        >
          <key.icon
            aria-hidden
            className={cn("size-[18px] shrink-0", byFold(expanded, "lg:size-4", "", "xl:size-4"))}
          />
          <span
            className={cn(
              "hidden text-[13px] font-medium",
              byFold(expanded, "lg:inline", "", "xl:inline"),
            )}
          >
            {key.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * The console's sections: a rail from lg, a bottom bar below.
 *
 * The rail opens labelled, by request (seven bare icons are seven guesses),
 * and its top-left button folds it to icons only, with no tooltip, by request.
 * The fold is instant: an eased width would resize both map canvases on every
 * frame. It is not remembered across reloads; if it ever is, it belongs in
 * lib/task/draft-store.ts, the one home for browser storage.
 *
 * Until the button is pressed the width decides, in CSS: folded from lg,
 * labelled from xl. At lg the labelled rail left a two-column screen ~830 px,
 * and a class-only default cannot disagree with the server render. A press
 * then holds, whatever the width does after it.
 */
export function NavRail() {
  const pathname = usePathname();
  // null until pressed: the breakpoint's default, which only CSS knows.
  const [expanded, setExpanded] = React.useState<boolean | null>(null);
  // In the handler, never in render: what the rail looks like right now is
  // the one thing a first press has to ask the browser.
  const toggle = () =>
    setExpanded((open) => !(open ?? window.matchMedia(LABELLED_BY_DEFAULT).matches));

  return (
    <nav
      aria-label="Console sections"
      className={cn(
        "flex shrink-0 items-center border-hairline bg-panel",
        // Mobile: the height adds the home-indicator inset and the padding pays
        // it back, so the 56 px content box is the same on every phone.
        "order-last h-[calc(3.5rem+env(safe-area-inset-bottom))] flex-row gap-1 border-t pr-[max(0.5rem,env(safe-area-inset-right))] pb-[env(safe-area-inset-bottom)] pl-[max(0.5rem,env(safe-area-inset-left))]",
        // Desktop: the 10 px item margin lands the tick (-9px) on the edge.
        "lg:order-first lg:h-auto lg:flex-col lg:justify-start lg:gap-1 lg:border-t-0 lg:border-r lg:px-2.5 lg:py-3",
        byFold(
          expanded,
          "lg:w-48 lg:items-stretch",
          "lg:w-14",
          "lg:w-14 xl:w-48 xl:items-stretch",
        ),
      )}
    >
      {/* The rail's head is the fold alone, by request. */}
      <div className="hidden shrink-0 lg:mb-4 lg:flex">
        <button
          type="button"
          onClick={toggle}
          // Unpressed, the state is the breakpoint's, which render cannot
          // read: the name below still follows it, the attribute waits.
          aria-expanded={expanded ?? undefined}
          className="flex size-9 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {/* Both faces, one of them `display: none`, so the glyph and the
            * accessible name follow the width before the first press. */}
          <span className={byFold(expanded, "contents", "hidden", "hidden xl:contents")}>
            <PanelLeftCloseIcon aria-hidden className="size-[18px]" />
            <span className="sr-only">Collapse the sidebar</span>
          </span>
          <span className={byFold(expanded, "hidden", "contents", "contents xl:hidden")}>
            <PanelLeftOpenIcon aria-hidden className="size-[18px]" />
            <span className="sr-only">Expand the sidebar</span>
          </span>
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
              item.railOnly && "max-lg:hidden",
              rowFold(expanded),
              active
                ? "bg-elevated text-foreground"
                : "text-muted-foreground hover:bg-elevated/60 hover:text-foreground",
            )}
          >
            <item.icon className="size-[18px] shrink-0" />
            {/* The bottom bar is labelled from md, where a seventh of the
              * width holds one. A size up from an instrument label: this is
              * navigation, read once, not a readout's caption. */}
            <span
              className={cn(
                "hidden truncate text-[13px] font-medium md:inline",
                byFold(expanded, "", "lg:hidden", "lg:hidden xl:inline"),
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

      {/* The rail's foot, under a rule of its own: what these two change is
        * the console, not the screen on show. The theme over the way out. */}
      <div className="flex shrink-0 lg:-mx-2.5 lg:mt-auto lg:flex-col lg:items-center lg:gap-1 lg:border-t lg:border-hairline lg:px-2.5 lg:pt-3">
        <ThemeSwitch expanded={expanded} />
        {/* From lg only: the phone's bar is seven tabs and the theme already,
          * so a phone signs out from Settings. Nothing to send — see
          * SignOutButton, the same press on a page. */}
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          className={cn(
            "hidden h-9 shrink-0 items-center justify-center gap-2 rounded-sm text-muted-foreground transition-colors hover:bg-elevated/60 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:flex",
            rowFold(expanded),
          )}
        >
          <LogOutIcon aria-hidden className="size-[18px] shrink-0" />
          <span
            className={cn(
              "truncate text-[13px] font-medium",
              byFold(expanded, "", "hidden", "hidden xl:inline"),
            )}
          >
            Sign out
          </span>
        </button>
      </div>
    </nav>
  );
}
