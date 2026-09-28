"use client";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { MapLibrary } from "@/components/maps/map-library";

export default function MapsPage() {
  const { state } = useConsoleRobotState();

  return (
    // Like /settings, this screen owns its scroll: the shell's <main> does not.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Maps</h1>
          {/* One line, by request. What it used to spell out lives where it
            * applies: the switch dialog says to set the robot's position
            * afterwards, and Rename and Delete are greyed on the map in use. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Switch, edit and manage the maps{" "}
            <span className="readout">{state?.robot_id ?? "this robot"}</span>{" "}
            works in.
          </p>
        </header>

        <MapLibrary />
      </div>
    </div>
  );
}
