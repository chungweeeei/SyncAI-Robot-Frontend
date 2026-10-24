"use client";

import Link from "next/link";
import { GaugeIcon, PaletteIcon, RouteIcon, WifiIcon } from "lucide-react";

import { RobotName } from "@/components/console/robot-name";
import { RestartControl } from "@/components/settings/restart-control";
import { SettingsPage } from "@/components/settings/settings-page";
import {
  Card,
  CardDescription,
  CardTitle,
} from "@/components/ui/card";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";

// Each setting is its own route: a new one is a row here and a page beside
// the others.
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
 * The Settings landing: a card per section, and the robot's restart. The
 * cards read no state, by request — they are a way in, not a second readout.
 */
export function SettingsIndex() {
  const { state } = useConsoleRobotState();

  return (
    <SettingsPage
      title="Settings"
      description={
        <>
          View and edit settings for <RobotName id={state?.robot_id} />.
        </>
      }
      parents={[]}
      action={<RestartControl />}
      wide
    >
    <nav aria-label="Settings sections">
      {/* Square tiles, more per row as the window widens, so a new
        * section fills a row rather than lengthening a list. */}
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
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
    </SettingsPage>
  );
}
