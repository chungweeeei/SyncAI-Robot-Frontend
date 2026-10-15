// Where a dock step really starts: the approach point in front of the dock.
// The robot works it out itself from the dock pose it is sent; this copy exists
// only so the floor plan can show the operator the leg no row of theirs names.

import type { PlanarPose } from "@/lib/types/robot";

/**
 * Metres back from the dock along its heading. Transcribed from the robot's
 * dock and undock behaviours (`ComputeStagingPose distance="1.0"` in the task
 * runner's dock.xml / undock.xml); a change there is a change here.
 */
export const DOCK_STAGING_DISTANCE_M = 1.0;

/**
 * The approach point for a dock pose (`theta` in degrees, the waypoint's own
 * unit): straight back along the heading the robot docks facing, with that
 * same heading, so the last metre is a straight walk forward. Undocking backs
 * out to the same point.
 */
export function stagingPose(dock: PlanarPose): PlanarPose {
  const radians = (dock.theta * Math.PI) / 180;
  return {
    x: dock.x - DOCK_STAGING_DISTANCE_M * Math.cos(radians),
    y: dock.y - DOCK_STAGING_DISTANCE_M * Math.sin(radians),
    theta: dock.theta,
  };
}
