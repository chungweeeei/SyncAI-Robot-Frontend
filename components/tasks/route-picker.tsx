"use client";

import * as React from "react";
import { CheckIcon, Undo2Icon } from "lucide-react";

import { FloorPicker } from "@/components/console/floor-picker";
import { Segmented } from "@/components/console/instrument";
import { RouteCanvas3d } from "@/components/tasks/route-canvas-3d";
import { WaypointPreview } from "@/components/tasks/waypoint-preview";
import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { drawnGround, floorBands, floorGround } from "@/lib/map/floors";
import type { MapEditorView } from "@/lib/map/links";
import { STEP_TYPES, stepTypeForVertex } from "@/lib/task/step";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

const VIEW_OPTIONS = [
  { value: "2d", label: "Floor plan" },
  { value: "3d", label: "3D map" },
] as const;

export interface RoutePickerProps {
  mapName: string;
  /** The map's floor plan geometry; null when it has none. */
  mapGrid: MapMetadata | null;
  /**
   * What the map can be picked on, the map editor's rule (editorViews): its
   * floor plan, its 3D map, or both. Never empty; the caller withholds the
   * panel then.
   */
  views: readonly MapEditorView[];
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
 * Plan route: the job's route built by tapping its stops in order, each tap
 * one step at the end of the list. A ten-stop patrol was forty presses through
 * Add, unfold and a dropdown per row; here it is ten taps on the map the
 * operator was reading anyway.
 *
 * Undo last walks back only what this panel added, newest first, and skips a
 * row already removed from the list; a row added any other way is never its
 * to take. The keyboard path stays the Add row and each row's dropdown.
 *
 * A map with a floor plan opens on it, as the map editor does; a map with
 * only a 3D map is picked in 3D, and one with both offers the switch. The
 * 3D map is fetched only once that view is on screen.
 */
export function RoutePicker({
  mapName,
  mapGrid,
  views,
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

  const [chosenView, setChosenView] = React.useState<MapEditorView>(views[0] ?? "2d");
  // A view the map lost (a floor plan gone back to converting) falls back.
  const view = views.includes(chosenView) ? chosenView : (views[0] ?? "2d");
  const tree = useMapOctomap(view === "3d" ? mapName : null);
  const { floors } = useMapFloors(view === "3d" ? mapName : null);
  const bands = React.useMemo(() => floorBands(floors), [floors]);
  const [floorName, setFloorName] = React.useState<string | null>(null);
  const floor = bands.find((each) => each.name === floorName) ?? null;
  const band = React.useMemo(
    () => (floor ? { lo: floor.lo, hi: floor.hi } : null),
    [floor],
  );

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
        {/* Icons only, so the hint keeps the row; the name is the label and
          * the tooltip, as an icon-only control needs both. */}
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Undo last"
            title="Undo last"
            onClick={undo}
            disabled={undoable.length === 0}
            className="flex size-7 items-center justify-center rounded-sm border border-hairline text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent pointer-coarse:size-10"
          >
            <Undo2Icon className="size-3.5" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Done"
            title="Done"
            onClick={onDone}
            className="flex size-7 items-center justify-center rounded-sm border border-signal-cmd/40 text-signal-cmd transition-colors hover:bg-signal-cmd/12 pointer-coarse:size-10"
          >
            <CheckIcon className="size-3.5" aria-hidden />
          </button>
        </div>
      </div>
      {views.length > 1 && (
        <Segmented
          label="Plan on"
          value={view}
          options={VIEW_OPTIONS}
          onChange={setChosenView}
        />
      )}
      {view === "2d" && mapGrid ? (
        <WaypointPreview
          mapName={mapName}
          meta={mapGrid}
          vertices={vertices}
          steps={stepMarks}
          docks={dockMarks}
          route={route}
          onPick={pick}
        />
      ) : tree.voxels ? (
        <RouteCanvas3d
          voxels={tree.voxels}
          vertices={vertices}
          band={band}
          groundZ={drawnGround(floorGround(floor))}
          steps={stepMarks}
          route={route}
          onPick={pick}
        >
          {/* A map of one storey has nothing to pick. */}
          {bands.length > 1 && (
            <FloorPicker floors={floors} value={floorName} onChange={setFloorName} />
          )}
        </RouteCanvas3d>
      ) : (
        <p className="flex h-64 items-center justify-center rounded-sm border border-hairline text-[11px] text-muted-foreground sm:h-80">
          {tree.status === "error" ? tree.error : "Loading the 3D map…"}
        </p>
      )}
      <p role="status" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
