"use client";

import * as React from "react";
import { CheckIcon, Undo2Icon } from "lucide-react";

import { WaypointPreview } from "@/components/tasks/waypoint-preview";
import { STEP_TYPES, stepTypeForVertex } from "@/lib/task/step";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

export interface RoutePickerProps {
  mapName: string;
  mapGrid: MapMetadata;
  vertices: MapVertex[];
  /** Vertex id → the job's step numbers that go there; see stepWaypointOrdinals. */
  stepMarks: ReadonlyMap<string, readonly number[]>;
  dockMarks: ReadonlySet<string>;
  /** The waypoints in visiting order; see stepRoute. */
  route: readonly string[];
  /** The job's length now, so the next tap can be announced by its number. */
  stepCount: number;
  /** Append a step set to this waypoint; returns its row key. */
  onPick: (vertex: MapVertex) => number;
  /** Take out a row this panel added. */
  onUndo: (key: number) => void;
  /** Whether a row this panel added is still in the list. */
  hasStep: (key: number) => boolean;
  onDone: () => void;
}

/**
 * Pick on map: the job's route built by tapping its stops in order, each tap
 * one step at the end of the list. A ten-stop patrol was forty presses through
 * Add, unfold and a dropdown per row; here it is ten taps on the map the
 * operator was reading anyway.
 *
 * Undo last walks back only what this panel added, newest first, and skips a
 * row already removed from the list; a row added any other way is never its
 * to take. The keyboard path stays the Add row and each row's dropdown.
 */
export function RoutePicker({
  mapName,
  mapGrid,
  vertices,
  stepMarks,
  dockMarks,
  route,
  stepCount,
  onPick,
  onUndo,
  hasStep,
  onDone,
}: RoutePickerProps) {
  const [added, setAdded] = React.useState<readonly number[]>([]);
  const [announcement, setAnnouncement] = React.useState("");
  // Rows the operator removed by hand are gone from the list, not from Undo's
  // stack; dropped here so the button never counts a row it cannot take.
  const undoable = added.filter(hasStep);

  const pick = (vertex: MapVertex) => {
    const key = onPick(vertex);
    setAdded((current) => [...current, key]);
    const type = STEP_TYPES.find((spec) => spec.value === stepTypeForVertex(vertex))?.label;
    setAnnouncement(`Added step ${stepCount + 1}: ${type} to ${vertex.name}.`);
  };

  const undo = () => {
    const key = undoable[undoable.length - 1];
    if (key === undefined) return;
    onUndo(key);
    setAdded((current) => current.filter((each) => each !== key));
    setAnnouncement(`Removed the last step added on the map.`);
  };

  return (
    <div className="space-y-1.5 rounded-sm border border-signal-cmd/40 bg-signal-cmd/5 p-1.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="min-w-0 flex-1 text-[11px] leading-snug text-muted-foreground">
          Tap waypoints in the order to visit them. Each adds a step at the end; a
          charger adds a Dock.
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={undo}
            disabled={undoable.length === 0}
            className="instrument-label flex h-7 items-center gap-1 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:h-10"
          >
            <Undo2Icon className="size-3" aria-hidden />
            Undo last
          </button>
          <button
            type="button"
            onClick={onDone}
            className="instrument-label flex h-7 items-center gap-1 rounded-sm border border-signal-cmd/40 px-2 text-signal-cmd transition-colors hover:bg-signal-cmd/12 pointer-coarse:h-10"
          >
            <CheckIcon className="size-3" aria-hidden />
            Done
          </button>
        </div>
      </div>
      <WaypointPreview
        mapName={mapName}
        meta={mapGrid}
        vertices={vertices}
        steps={stepMarks}
        docks={dockMarks}
        route={route}
        onPick={pick}
      />
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
