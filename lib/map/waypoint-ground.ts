// The height a waypoint placed on a 3D map is stored at: the rule the
// dashboard and the editor's 3D view share, so a stop put down on either lands at
// the same z.

import {
  FLOOR_BAND_BELOW_M,
  FLOOR_GROUND_BELOW_LEVEL_M,
  type FloorBand,
  floorGround,
} from "@/lib/map/floors";
import { floorHeightIn, groundAt } from "@/lib/map/ground";
import type { OccupiedVoxels } from "@/lib/types/octree";

/**
 * A floor's ground: where the 3D map shows it, else a body height under its
 * level (also before the tree has loaded). Walks every cell of the tree, so a
 * caller that draws with it memoises it.
 */
export function floorGroundOf(voxels: OccupiedVoxels | null, band: FloorBand | null): number {
  return floorGround(band, band && voxels ? floorHeightIn(voxels, band.lo, band.hi) : null);
}

/**
 * The ground under a point on a floor: where the 3D map shows it in that
 * column, else the floor's own — over a hole, or before the tree has loaded.
 * A floor is rarely one height (a ramp, a step between two halls), and the
 * floor's median put every stop on it at one z, half a metre off on dp's 2F.
 */
export function groundUnder(
  voxels: OccupiedVoxels | null,
  band: FloorBand,
  x: number,
  y: number,
): number {
  return (voxels ? groundAt(voxels, x, y, band.lo, band.hi) : null) ?? floorGroundOf(voxels, band);
}

/**
 * The ground under a point on a 3D map with no floors: the lowest occupied
 * cell of its column, or null off the tree, over a hole, or with no tree.
 * One storey, so the column holds one ground — and that ground is not one
 * height: outdoor_1027 falls 1.4 m from the origin to its far end, and the
 * robot's planner looks for the ground only a metre either side of a stop's
 * z, so a 0 there was a stop it could not reach.
 */
export function columnGround(voxels: OccupiedVoxels | null, x: number, y: number): number | null {
  return voxels ? groundAt(voxels, x, y, -Infinity, Infinity) : null;
}

/**
 * The z a placed or re-placed waypoint is written with. On a floor picked it
 * is the ground under it. On a 3D map with no floors — one storey, however
 * the ground slopes — it is the ground under it too (`columnGround`), a
 * re-place included, since there is no other storey to keep it on. With
 * floors but none picked, a re-place keeps its own height — moving a 2F stop
 * a metre must not drop it to the ground floor because 2F was not up — and a
 * new stop is on the ground floor, 0, as every stop was before floors. With
 * no tree (not read yet) there is no ground to read, so stops stay at 0.
 */
export function placedGround({
  voxels,
  band,
  hasFloors,
  x,
  y,
  moving = null,
}: {
  voxels: OccupiedVoxels | null;
  band: FloorBand | null;
  /** Whether the map has floors at all (`useMapFloors` gave a non-empty list). */
  hasFloors: boolean;
  x: number;
  y: number;
  /** The stop's own height when this is a re-place. */
  moving?: number | null;
}): number {
  if (band) return groundUnder(voxels, band, x, y);
  if (!hasFloors) {
    const ground = columnGround(voxels, x, y);
    if (ground !== null) return ground;
  }
  return moving ?? floorGroundOf(voxels, null);
}

/**
 * The ground under the robot, for a stop put where it stands: on the floor
 * its body height is in. On a 3D map with no floors, the lowest cell of its
 * column within a floor's band under its body (`FLOOR_BAND_BELOW_M`), else a
 * body height under it — the column alone could reach under a ledge it stands
 * on. Else (no tree read, or a height on no floor) the ground floor's 0.
 */
export function robotGround(
  voxels: OccupiedVoxels | null,
  bands: readonly FloorBand[],
  pose: { x: number; y: number; z: number },
): number {
  if (voxels && bands.length === 0) {
    return (
      groundAt(voxels, pose.x, pose.y, pose.z - FLOOR_BAND_BELOW_M, pose.z) ??
      pose.z - FLOOR_GROUND_BELOW_LEVEL_M
    );
  }
  const band = bands.find((b) => pose.z >= b.lo && pose.z < b.hi) ?? null;
  return band ? groundUnder(voxels, band, pose.x, pose.y) : floorGroundOf(voxels, null);
}
