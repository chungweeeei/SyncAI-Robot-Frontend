"use client";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { MapLibrary } from "@/components/maps/map-library";
import { RobotName } from "@/components/console/robot-name";

export default function MapsPage() {
  const { state } = useConsoleRobotState();

  return (
    // The screen owns its scroll, at every library screen's width so the
    // header does not move between them.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Maps</h1>
          {/* One line, by request: the details live where they apply. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Switch, edit and manage the maps{" "}
            <RobotName id={state?.robot_id} />{" "}
            works in.
          </p>
        </header>

        <MapLibrary />
      </div>
    </div>
  );
}
