// The height a waypoint placed on a 3D map is stored at: the rule the
// dashboard and the 3D map page share, so a stop put down on either lands at
// the same z.

import { type FloorBand, floorGround } from "@/lib/map/floors";
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
 * The z a placed or re-placed waypoint is written with. On a floor picked it
 * is the ground under it. With none picked, a re-place keeps its own height —
 * moving a 2F stop a metre must not drop it to the ground floor because 2F
 * was not up — and a new stop is on the ground floor, 0, as every stop was
 * before floors. A map with no floors (a 2D one) only ever takes that branch.
 */
export function placedGround({
  voxels,
  band,
  x,
  y,
  moving = null,
}: {
  voxels: OccupiedVoxels | null;
  band: FloorBand | null;
  x: number;
  y: number;
  /** The stop's own height when this is a re-place. */
  moving?: number | null;
}): number {
  if (band) return groundUnder(voxels, band, x, y);
  return moving ?? floorGroundOf(voxels, null);
}

/**
 * The ground under the robot, for a stop put where it stands: on the floor
 * its body height is in, else the ground floor's 0.
 */
export function robotGround(
  voxels: OccupiedVoxels | null,
  bands: readonly FloorBand[],
  pose: { x: number; y: number; z: number },
): number {
  const band = bands.find((b) => pose.z >= b.lo && pose.z < b.hi) ?? null;
  return band ? groundUnder(voxels, band, pose.x, pose.y) : floorGroundOf(voxels, null);
}
