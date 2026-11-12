// Where a dock step really starts: the approach point in front of the dock.
// The robot works it out itself from the dock pose it is sent and does not
// publish it, so this copy is what the console draws in both places it shows
// the leg no row of the operator's names: the dashboard while a dock runs
// (lib/scene/dock-layer.ts).

import { normalizeTheta, toRadians } from "@/lib/angle";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * Metres back from the dock along its heading. Transcribed from the robot's
 * dock behaviour (`ComputeStagingPose distance="1.0"` in the task runner's
 * dock.xml); a change there is a change here.
 */
export const DOCK_STAGING_DISTANCE_M = 1.0;

/**
 * The approach point for a dock pose (`theta` in degrees, the waypoint's own
 * unit): straight back along the heading the robot docks facing, with that
 * same heading, so the last metre is a straight walk forward.
 */
export function stagingPose(dock: PlanarPose): PlanarPose {
  const radians = toRadians(dock.theta);
  return {
    x: dock.x - DOCK_STAGING_DISTANCE_M * Math.cos(radians),
    y: dock.y - DOCK_STAGING_DISTANCE_M * Math.sin(radians),
    theta: dock.theta,
  };
}

/**
 * A dock's heading from its charger's mark as the robot sees it (degrees).
 * The detector answers with the mark's normal, out of the wall towards a
 * robot in front of it; a dock pose's heading is the one the robot walks on
 * facing, into the wall. Stored as seen, the staging point above lands a
 * metre inside the wall, facing away from the charger.
 */
export function dockHeadingFromMark(markTheta: number): number {
  return normalizeTheta(markTheta + 180);
}
