// Where a charge really starts: the approach point in front of the charger.
// The robot works it out itself from the marker pose it is sent and does not
// publish it, so this copy is what the console draws in the places it shows
// the leg no row of the operator's names: the dashboard while a charge runs
// (lib/scene/dock-layer.ts) and a charger's route preview.

import { normalizeTheta, toRadians } from "@/lib/angle";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * Metres out from a charger's marker. Transcribed from the robot's charge
 * behaviour (`ComputeStagingPose distance="1.3"` in the task runner's
 * charge.xml, out from the marker along its face), where the camera can read
 * the marker; a change there is a change here. (The DOCK step's 1.0 m went
 * with it on 2026-11-12.)
 */
export const CHARGE_STAGING_DISTANCE_M = 1.3;

/**
 * The approach point for a charger (`theta` in degrees, the waypoint's own
 * unit). A charger waypoint's heading is the marker's, out of its face, the
 * way its 3D charger is drawn and charge.xml takes it: the point is straight
 * out along it, turned to face back at the charger, and the last stretch is a
 * walk forward onto it.
 */
export function stagingPose(charger: PlanarPose, distance = CHARGE_STAGING_DISTANCE_M): PlanarPose {
  const radians = toRadians(charger.theta);
  return {
    x: charger.x + distance * Math.cos(radians),
    y: charger.y + distance * Math.sin(radians),
    theta: normalizeTheta(charger.theta + 180),
  };
}
