"use client";

import * as React from "react";

import { FloorPicker } from "@/components/console/floor-picker";
import { RouteCanvas3d } from "@/components/tasks/route-canvas-3d";
import { useMapFloors } from "@/hooks/use-map-floors";
import { useMapOctomap } from "@/hooks/use-map-octomap";
import { drawnGround, floorBands, floorGround } from "@/lib/map/floors";
import type { RoutePoint } from "@/lib/map/preview";
import type { MapVertex } from "@/lib/types/map";

/**
 * Tall enough to plan on beside the stops from lg, a band above them below.
 * From lg it fills the screen under the page chrome, so Save stays in view,
 * and the cap only stops a tall monitor from stretching the plan past use.
 */
const MAP_HEIGHT = "h-72 sm:h-96 lg:h-[min(56rem,calc(100dvh-16rem))]";

export interface RouteMapProps {
  mapName: string;
  vertices: MapVertex[];
  /** Vertex id → the job's stop numbers that go there; see stopWaypointOrdinals. */
  stopMarks: ReadonlyMap<string, readonly number[]>;
  /** The waypoints in visiting order; see stepRoute. */
  route: readonly RoutePoint[];
  /** Adds the waypoint as a stop; absent while the job runs, when the map only shows. */
  onPick?: (vertex: MapVertex) => void;
  /** The waypoint the stop card under the pointer or selected goes to. */
  highlight: string | null;
  /** That stop's row, whose leg in is drawn bold; a hovered card fades the rest. */
  focus: { key: number; fade: boolean } | null;
  onHover: (vertex: MapVertex | null) => void;
}

/**
 * The editor's map, beside the stops for the whole edit rather than opened
 * per row: the route is built by clicking waypoints in the order to visit
 * them, each a stop after the one selected, and the card under the pointer
 * is ringed here as the waypoint under the pointer lights its cards.
 *
 * Drawn on the map's 3D map, one floor at a time on a map that spans
 * storeys. The caller shows it only for a map whose 3D map is built.
 */
export function RouteMap({
  mapName,
  vertices,
  stopMarks,
  route,
  onPick,
  highlight,
  focus,
  onHover,
}: RouteMapProps) {
  const tree = useMapOctomap(mapName);
  const { floors } = useMapFloors(mapName);
  const bands = React.useMemo(() => floorBands(floors), [floors]);
  const [floorName, setFloorName] = React.useState<string | null>(null);
  const floor = bands.find((each) => each.name === floorName) ?? null;
  const band = React.useMemo(() => (floor ? { lo: floor.lo, hi: floor.hi } : null), [floor]);

  // Nothing picks while the job runs; a no-op keeps the view's tap path whole.
  const pick = onPick ?? (() => {});

  return (
    <div className="space-y-1.5">
      {tree.voxels ? (
        <RouteCanvas3d
          voxels={tree.voxels}
          vertices={vertices}
          band={band}
          groundZ={drawnGround(floorGround(floor))}
          steps={stopMarks}
          route={route}
          onPick={pick}
          highlight={highlight}
          focus={focus}
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
