// The map catalogue, as GET /api/v1/maps returns it (snake_case, mirroring the
// backend), checked in lib/api/map.ts.
//
// A map is a directory under `map/`: the mapping save writes the scan, then
// the robot's map cleaning builds the 3D map (octomap.bt) minutes later. That
// can lag or fail, which is why `octomap_status` is more than a yes or no.

import { z } from "zod";

export const OctomapStatusSchema = z.enum([
  "none",
  "converting",
  "ok",
  "failed",
  "interrupted",
]);

export const VertexTypeSchema = z.enum(["MOVE", "CHARGE"]);

/**
 * How a map's 3D map stands. The three unusable states are kept apart because
 * they ask different things of the operator:
 *
 * - `none` — never built.
 * - `failed` — the robot's map cleaning rejected it; `octomap_error` says why.
 * - `interrupted` — the build went away mid-way; a retry very likely works.
 */
export type OctomapStatus = z.infer<typeof OctomapStatusSchema>;

export interface MapSummary {
  /** Directory name — the identity everything keys off. */
  name: string;
  /**
   * Whether the running stack loaded this map. Server-derived on purpose:
   * `RobotState.map` is a *path*, and parsing it
   * is not the UI's job.
   */
  active: boolean;
  /** The scan the localizer relocalizes against. */
  has_pointcloud: boolean;
  /** The whole directory, dominated by the scan. */
  size_bytes: number;
  /** ISO 8601, newest file in the directory. */
  modified_at: string;
  vertex_count: number;
  /**
   * How the map's 3D map stands — the occupancy tree the robot's map cleaning
   * writes beside the scan, which the robot navigates on, the dashboard draws
   * and the editor patches and places waypoints on. Only an `"ok"` map can be
   * switched to.
   */
  octomap_status: OctomapStatus;
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
  /** **Degrees**, CCW from +x — not radians. */
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
 *
 * `z_min` / `z_max` are the floor it forbids on a 3D map: the ground heights,
 * map-frame metres, between which the robot's 3D planner applies it (the
 * ground's z, not the body's). Unset (absent or null) is unbounded, so a zone
 * with neither covers every floor. `name` is a label. All three come back from
 * the robot and must go back to it unchanged: a save is the whole list, and a
 * zone sent without its band widens to every storey.
 */
export interface ZonePolygon {
  id: string;
  points: ZonePoint[];
  name?: string | null;
  z_min?: number | null;
  z_max?: number | null;
}

export const ZonePolygonSchema: z.ZodType<ZonePolygon> = z.object({
  id: z.string(),
  points: z.array(z.object({ x: z.number(), y: z.number() })),
  name: z.string().nullish(),
  z_min: z.number().nullish(),
  z_max: z.number().nullish(),
});

/**
 * One storey of a map that spans several: what it is called and the body
 * height the robot stands at on it, metres in the map frame (the trajectory's
 * z, about half a metre above the ground it walks on).
 */
export interface MapFloor {
  name: string;
  level: number;
  /**
   * The lowest and highest body heights the robot walked on this floor,
   * metres: a floor that is not flat — a slope, a ramp down to a bay — spans
   * more than its level. Null or absent on a floor named by hand, which is
   * drawn around its level alone.
   */
  low?: number | null;
  high?: number | null;
}
