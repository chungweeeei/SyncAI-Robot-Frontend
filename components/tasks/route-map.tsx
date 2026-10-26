"use client";

import * as React from "react";

import { FloorPicker } from "@/components/console/floor-picker";
import { Segmented } from "@/components/console/instrument";
import { RouteCanvas3d } from "@/components/tasks/route-canvas-3d";
import { WaypointPreview } from "@/components/tasks/waypoint-preview";
import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { drawnGround, floorBands, floorGround } from "@/lib/map/floors";
import type { MapEditorView } from "@/lib/map/links";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

const VIEW_OPTIONS = [
  { value: "2d", label: "Floor plan" },
  { value: "3d", label: "3D map" },
] as const;

/** Tall enough to plan on beside the stops from lg, a band above them below. */
const MAP_HEIGHT = "h-72 sm:h-96 lg:h-[min(36rem,calc(100dvh-16rem))]";

export interface RouteMapProps {
  mapName: string;
  /** The map's floor plan geometry; null when it has none. */
  mapGrid: MapMetadata | null;
  /**
   * What the map can be shown on, the map editor's rule (editorViews): its
   * floor plan, its 3D map, or both. Never empty; the caller says why instead.
   */
  views: readonly MapEditorView[];
  vertices: MapVertex[];
  /** Vertex id → the job's stop numbers that go there; see stopWaypointOrdinals. */
  stopMarks: ReadonlyMap<string, readonly number[]>;
  dockMarks: ReadonlySet<string>;
  /** The waypoints in visiting order; see stepRoute. */
  route: readonly string[];
  /** Adds the waypoint as a stop; absent while the job runs, when the map only shows. */
  onPick?: (vertex: MapVertex) => void;
  /** The waypoint the stop card under the pointer or selected goes to. */
  highlight: string | null;
  onHover: (vertex: MapVertex | null) => void;
}

/**
 * The editor's map, beside the stops for the whole edit rather than opened
 * per row: the route is built by clicking waypoints in the order to visit
 * them, each a stop after the one selected, and the card under the pointer
 * is ringed here as the waypoint under the pointer lights its cards.
 *
 * A map with a floor plan opens on it, as the map editor does; a map with
 * only a 3D map is shown in 3D, and one with both offers the switch. The 3D
 * map is fetched only once that view is on screen.
 */
export function RouteMap({
  mapName,
  mapGrid,
  views,
  vertices,
  stopMarks,
  dockMarks,
  route,
  onPick,
  highlight,
  onHover,
}: RouteMapProps) {
  const [chosenView, setChosenView] = React.useState<MapEditorView>(views[0] ?? "2d");
  // A view the map lost (a floor plan gone back to converting) falls back.
  const view = views.includes(chosenView) ? chosenView : (views[0] ?? "2d");
  const tree = useMapOctomap(view === "3d" ? mapName : null);
  const { floors } = useMapFloors(view === "3d" ? mapName : null);
  const bands = React.useMemo(() => floorBands(floors), [floors]);
  const [floorName, setFloorName] = React.useState<string | null>(null);
  const floor = bands.find((each) => each.name === floorName) ?? null;
  const band = React.useMemo(() => (floor ? { lo: floor.lo, hi: floor.hi } : null), [floor]);

  // Nothing picks while the job runs; a no-op keeps the 3D view's tap path whole.
  const pick = onPick ?? (() => {});

  return (
    <div className="space-y-1.5">
      {views.length > 1 && (
        <Segmented label="Show on" value={view} options={VIEW_OPTIONS} onChange={setChosenView} />
      )}
      {view === "2d" && mapGrid ? (
        <WaypointPreview
          mapName={mapName}
          meta={mapGrid}
          vertices={vertices}
          steps={stopMarks}
          docks={dockMarks}
          route={route}
          onPick={onPick}
          highlight={highlight}
          onHover={onHover}
          className={MAP_HEIGHT}
        />
      ) : tree.voxels ? (
        <RouteCanvas3d
          voxels={tree.voxels}
          vertices={vertices}
          band={band}
          groundZ={drawnGround(floorGround(floor))}
          steps={stopMarks}
          route={route}
          onPick={pick}
          highlight={highlight}
          onHover={onHover}
          className={MAP_HEIGHT}
        >
          {/* A map of one storey has nothing to pick. */}
          {bands.length > 1 && (
            <FloorPicker floors={floors} value={floorName} onChange={setFloorName} />
          )}
        </RouteCanvas3d>
      ) : (
        <p
          className={`flex items-center justify-center rounded-sm border border-hairline text-[11px] text-muted-foreground ${MAP_HEIGHT}`}
        >
          {tree.status === "error" ? tree.error : "Loading the 3D map…"}
        </p>
      )}
    </div>
  );
}
