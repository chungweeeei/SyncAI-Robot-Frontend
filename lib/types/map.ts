// The map catalogue, as GET /api/v1/maps returns it (snake_case, mirroring the
// backend). Not verbatim, fixed up in lib/api/map.ts: `grid.origin` arrives as
// {x, y, yaw}, and `thumbnail` as a relative path.
//
// A map is a directory under `map/`: the mapping save writes the scan, then a
// background conversion writes the floor plan. That can lag or fail, which is
// why `grid` is nullable.

import { z } from "zod";

import type { MapMetadata } from "@/lib/types/robot";

export const GridStatusSchema = z.enum([
  "none",
  "converting",
  "ok",
  "failed",
  "interrupted",
]);

export const VertexTypeSchema = z.enum(["MOVE", "CHARGE"]);

/**
 * How a map's floor plan stands. The three unloadable states are kept apart
 * because they ask different things of the operator:
 *
 * - `none` — never converted. Build it.
 * - `failed` — rejected; `grid_error` says why, and the same recipe will fail
 *   the same way.
 * - `interrupted` — the backend went away mid-conversion (restart or mode
 *   switch); a retry very likely works.
 */
export type GridStatus =
  | "none"
  | "converting"
  | "ok"
  | "failed"
  | "interrupted";

export interface MapSummary {
  /** Directory name — the identity everything keys off. */
  name: string;
  /**
   * Whether the running stack loaded this map. Server-derived on purpose:
   * `RobotState.map` is a *path* (`map/dp2f/gridmap.yaml`), and parsing it
   * is not the UI's job.
   */
  active: boolean;
  /** Null until the floor plan conversion has run; the map cannot be loaded then. */
  grid: MapMetadata | null;
  /** Null whenever `grid` is null. */
  thumbnail: string | null;
  /** The scan the localizer relocalizes against. */
  has_pointcloud: boolean;
  /**
   * The conversion's only status surface (there is no job resource), so a
   * client that starts one watches this until it leaves `"converting"`.
   */
  grid_status: GridStatus;
  /** Null unless `"failed"`. Operator-facing; render verbatim. */
  grid_error: string | null;
  /** @deprecated Kept for older callers; read `grid_status`. */
  grid_converting: boolean;
  /** The whole directory, dominated by the scan. */
  size_bytes: number;
  /** ISO 8601, newest file in the directory. */
  modified_at: string;
  vertex_count: number;
  /**
   * How the map's 3D map stands — the occupancy tree the robot's map cleaning
   * writes beside the scan when asked to, which the dashboard draws and the
   * editor's 3D view patches and places waypoints on. The same five words as
   * `grid_status`, read off a different file: `none` also covers a save that never asked for one.
   */
  octomap_status: GridStatus;
  /** Null unless `octomap_status` is `"failed"`. Operator-facing; render verbatim. */
  octomap_error: string | null;
  /**
   * An opaque tag for the 3D map's current bytes, null unless `"ok"`. The
   * backend changes it whenever the file is replaced (a re-clean, the robot's
   * edit tool), which is how the console's cache of the decoded tree is
   * retired — `modified_at` covers the whole directory and cannot say.
   */
  octomap_version: string | null;
  /** Cell edge of the 3D map in metres, null unless `"ok"`. */
  octomap_resolution: number | null;
}

/**
 * The two conversion recipes. No "auto" (size-based picking misrouted every
 * glass-walled hall). Traversability walls off everything it did not observe,
 * which is why choosing it is an operator act.
 */
export type GridRecipe = "z-band" | "traversability";

/**
 * Closed, because an unknown value 422s with a validation array rather than a
 * sentence an operator can read.
 */
export type VertexType = "MOVE" | "CHARGE";

export interface MapVertex {
  /** Server-assigned uuid, unique across all maps. */
  id: string;
  name: string;
  type: VertexType;
  /** Spelled as `MapSummary.name`. */
  map_name: string;
  /** Map frame, metres. */
  x: number;
  y: number;
  /** **Degrees**, CCW from +x — not radians, unlike `MapMetadata.origin[2]`. */
  theta: number;
  /**
   * Height of the ground the waypoint stands on, metres in the map frame:
   * which floor it is on (`floorOfHeight`) and what the robot's planner aims
   * a goal at. 0 is the ground floor.
   */
  z: number;
}

export const MapVertexSchema: z.ZodType<MapVertex> = z.object({
  id: z.string(),
  name: z.string(),
  type: VertexTypeSchema,
  map_name: z.string(),
  x: z.number(),
  y: z.number(),
  theta: z.number(),
  // A backend from before floors sends none, and every waypoint it holds is
  // on the ground floor.
  z: z.number().default(0),
});

/**
 * A forbidden zone corner, map-frame metres. The editor snaps it to the cell
 * centre the backend's rasteriser floors it onto.
 */
export interface ZonePoint {
  x: number;
  y: number;
}

/**
 * A forbidden zone: points in drawing order, first not repeated. The id is the
 * console's own; the backend keeps whatever it is sent.
 */
export interface ZonePolygon {
  id: string;
  points: ZonePoint[];
}

export const ZonePolygonSchema: z.ZodType<ZonePolygon> = z.object({
  id: z.string(),
  points: z.array(z.object({ x: z.number(), y: z.number() })),
});

/**
 * One storey of a map that spans several: what it is called and the body
 * height the robot stands at on it, metres in the map frame (the trajectory's
 * z, about half a metre above the ground it walks on).
 */
export interface MapFloor {
  name: string;
  level: number;
}
