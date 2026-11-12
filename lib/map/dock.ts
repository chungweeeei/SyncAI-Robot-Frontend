// Where a dock step really starts: the approach point in front of the dock.
// The robot works it out itself from the dock pose it is sent and does not
// publish it, so this copy is what the console draws in both places it shows
// the leg no row of the operator's names: the dashboard while a dock runs
// (lib/scene/dock-layer.ts).

import { normalizeTheta, toRadians } from "@/lib/angle";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * Metres out from the dock. Transcribed from the robot's dock behaviour
 * (`ComputeStagingPose distance="1.0"` in the task runner's dock.xml); a
 * change there is a change here.
 */
export const DOCK_STAGING_DISTANCE_M = 1.0;

/**
 * The approach point for a dock (`theta` in degrees, the waypoint's own unit).
 * A charger waypoint's heading is the charger's, out of its face, the way its
 * 3D charger is drawn; the backend turns it round into the one the robot
 * docks facing before dock.xml backs the staging pose off along that. So the
 * point is straight out along the charger's heading, turned to face back at
 * it, and the last metre is a straight walk forward onto it.
 */
export function stagingPose(dock: PlanarPose): PlanarPose {
  const radians = toRadians(dock.theta);
  return {
    x: dock.x + DOCK_STAGING_DISTANCE_M * Math.cos(radians),
    y: dock.y + DOCK_STAGING_DISTANCE_M * Math.sin(radians),
    theta: normalizeTheta(dock.theta + 180),
  };
}
