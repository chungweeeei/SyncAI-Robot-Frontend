/**
 * The dashboard's route preview: the route the planner would drive from where
 * the robot stood to an aimed goal, shown before anything is sent.
 *
 * A preview is a picture of one moment. The planner starts it at the robot,
 * so once the robot has walked off that start the route on screen no longer
 * begins where it is — and Go re-plans from wherever the robot then stands
 * anyway. Past STALE_AFTER_M it is said to be out of date rather than redrawn
 * by itself: a preview the operator did not ask for would be a request sent
 * on a timer.
 */

import { floorOfHeight } from "@/lib/map/floors";
import type { MapFloor } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * How far the robot may stand from the preview's start before the route is
 * out of date. Half a metre: the 1 Hz pose wanders a few centimetres standing
 * still, and a route that begins a body length behind the robot reads wrong.
 */
export const STALE_AFTER_M = 0.5;

/** The wire's [x, y, z] rows as the flat triples the route ribbon walks. */
export function previewPoints(points: readonly (readonly number[])[]): Float32Array {
  const out = new Float32Array(points.length * 3);
  points.forEach(([x, y, z], i) => {
    out[i * 3] = x;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = z;
  });
  return out;
}

/**
 * Whether the robot has moved off the start of a preview. Planar: the start's
 * z is the ground under it and the pose's a body height, and a robot that
 * climbs a stair has also moved along it. Unknown (no pose) is not stale —
 * a lost fix says nothing about where it went.
 */
export function previewStale(
  points: readonly (readonly number[])[],
  robot: Pick<PlanarPose, "x" | "y"> | null,
): boolean {
  if (robot === null || points.length === 0) return false;
  const [x, y] = points[0];
  return Math.hypot(robot.x - x, robot.y - y) > STALE_AFTER_M;
}

/**
 * The floors a route walks, in the order it walks them, each named once per
 * visit: `["1F", "2F"]` up a stair, `["2F", "1F", "2F"]` down and back up.
 * Empty on a map of one storey, where there is nothing to say. A stretch
 * between two floors' bands (a flight) names neither.
 */
export function routeFloors(
  points: readonly (readonly number[])[],
  floors: readonly MapFloor[],
): string[] {
  const out: string[] = [];
  for (const [, , z] of points) {
    const floor = floorOfHeight(z, floors);
    if (floor !== null && floor !== out[out.length - 1]) out.push(floor);
  }
  return out;
}
