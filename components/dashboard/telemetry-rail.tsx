"use client";

import { LocomotionControl } from "@/components/dashboard/locomotion-control";
import { MotorStatus } from "@/components/dashboard/motor-status";
import { PostureControl } from "@/components/dashboard/posture-control";
import type { RobotState } from "@/lib/types/robot";

/**
 * The instrument rail beside the viewport: posture, locomotion, motors — the
 * controls and the readings an operator consults rather than watches.
 *
 * Battery, mode and map name are *not* here — they live in the status strip,
 * because they qualify the whole console rather than this screen. The pose is
 * not here either: it is over the viewport's corner (PoseOverlay).
 */
export function TelemetryRail({ state }: { state: RobotState }) {
  return (
    <div className="divide-y divide-hairline">
      {/* No Pose group: it is laid over the viewport's corner now (PoseOverlay),
        * next to the marker it describes. No velocity row there either, by
        * request — how fast the robot is going was a reading nobody watched. */}

      {/* No Link group, by request. SSID, signal and IP are the Settings
        * screen's Wi-Fi panel, next to the network they describe; the strip's
        * link chip already says whether the console can reach the robot. */}

      <PostureControl robotId={state.robot_id} />

      {/* Under Posture, because that is the order they are used in: the robot has
        * to be standing before a controller choice means anything. Posture is still
        * commanded-only; this one is half measured, which is why it reads the state
        * frame rather than holding everything locally. */}
      <LocomotionControl lowLevelMode={state.low_level_mode} />

      {/* Last: it is the longest group and the one an operator consults, rather
        * than watches. Posture stays above the fold on a short rail. */}
      <MotorStatus motors={state.motor_status} />
    </div>
  );
}
