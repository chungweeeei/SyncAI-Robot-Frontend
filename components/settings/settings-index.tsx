"use client";

import Link from "next/link";
import { GaugeIcon, PaletteIcon, RouteIcon, WifiIcon } from "lucide-react";

import { RobotName } from "@/components/console/robot-name";
import { RestartControl } from "@/components/settings/restart-control";
import {
  Card,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";

// Each setting is its own route, so a new one is a row here and a page beside
// the others — the index never grows a second form.
const settingsSections = [
  // Planner and Controller come first and have no backend yet: their pages
  // say so rather than show a form that saves nothing.
  {
    title: "Planner",
    description: "Path planning",
    href: "/settings/planner",
    icon: RouteIcon,
  },
  {
    title: "Controller",
    description: "Motion control",
    href: "/settings/controller",
    icon: GaugeIcon,
  },
  {
    title: "Wi-Fi",
    description: "Network connection",
    href: "/settings/wifi",
    icon: WifiIcon,
  },
  {
    title: "Preferences",
    description: "Theme and display",
    href: "/settings/preferences",
    icon: PaletteIcon,
  },
];

/**
 * The Settings landing: a card per section, and the robot's restart.
 *
 * The cards read no state, by request: they are a way in, and a summary on
 * them would be a second readout of what the page behind them shows.
 * Restart stays here rather than on a section, because it belongs to none
 * of them — it is the robot's, not the network's or the console's.
 */
export function SettingsIndex() {
  const { state } = useConsoleRobotState();

  return (
    // Settings is the one screen that scrolls; the shell's <main> does not.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-4 py-4 sm:py-8">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              View and edit settings for <RobotName id={state?.robot_id} />.
            </p>
          </div>
          <RestartControl />
        </header>

        <nav aria-label="Settings sections">
          {/* Square tiles, two to a row on a phone and three from sm up, so
            * the next section fills the row rather than lengthening a list. */}
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {settingsSections.map(({ title, description, href, icon: Icon }) => (
              <li key={href}>
                <Link
                  href={href}
                  className="group block rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <Card className="aspect-square items-center justify-center gap-5 px-(--card-spacing) text-center transition-colors group-hover:bg-muted/50">
                    <Icon
                      className="size-10 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <div className="min-w-0 space-y-1">
                      <CardTitle>{title}</CardTitle>
                      <CardDescription className="line-clamp-3">
                        {description}
                      </CardDescription>
                    </div>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}
