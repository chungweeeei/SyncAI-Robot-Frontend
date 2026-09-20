"use client";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { MapLibrary } from "@/components/maps/map-library";

export default function MapsPage() {
  const { state } = useConsoleRobotState();

  return (
    // Like /settings, this screen owns its scroll: the shell's <main> does not.
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <header className="mb-6">
          <p className="instrument-label text-muted-foreground">Robot</p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">Maps</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Areas{" "}
            <span className="readout">{state?.robot_id ?? "this robot"}</span>{" "}
            can work in. The one it is using now is marked. Switching to another
            takes effect straight away and is remembered after a restart, but
            the robot loses track of where it is — set its position on the
            Dashboard afterwards. The map in use cannot be renamed or deleted.
          </p>
        </header>

        <MapLibrary />
      </div>
    </div>
  );
}
