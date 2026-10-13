"use client";

import { LocomotionControl } from "@/components/dashboard/locomotion-control";
import { MotorStatus } from "@/components/dashboard/motor-status";
import { ScheduleGlance } from "@/components/dashboard/schedule-glance";
import type { RobotState } from "@/lib/types/robot";

/**
 * The instrument rail beside the viewport: schedules, locomotion, motors.
 * Battery, mode and map are the status strip's; the pose is over the
 * viewport (PoseOverlay). Link and posture groups were dropped by request:
 * they live in Settings and the drive panel.
 */
export function TelemetryRail({ state }: { state: RobotState }) {
  return (
    <div className="divide-y divide-hairline">
      {/* First, by request: it changes the next ten minutes on its own. */}
      <ScheduleGlance />

      <LocomotionControl lowLevelMode={state.low_level_mode} />

      {/* Last: the longest group, so Locomotion stays above the fold. */}
      <MotorStatus motors={state.motor_status} />
    </div>
  );
}
