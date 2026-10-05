"use client";

import {
  InstrumentGroup,
  PrimaryReadout,
  Readout,
} from "@/components/console/instrument";
import { LocomotionControl } from "@/components/dashboard/locomotion-control";
import { MotorStatus } from "@/components/dashboard/motor-status";
import { PostureControl } from "@/components/dashboard/posture-control";
import type { RobotState } from "@/lib/types/robot";

/**
 * The instrument rail beside the viewport: pose, posture, locomotion, motors.
 *
 * These were four equal-weight cards above the map, which put the two numbers
 * an operator watches continuously (x/y and heading) at the same size as the
 * BSSID. Here the pose is the largest type on the screen after the robot id,
 * and everything else is a row.
 *
 * Battery, mode and map name are *not* here — they live in the status strip,
 * because they qualify the whole console rather than this screen.
 */
export function TelemetryRail({ state }: { state: RobotState }) {
  const { position } = state.localization_status;
  // A false flag means the pose fields are a zeroed placeholder, not a
  // reading — a state frame arrives before the localizer converges (and all
  // through a mapping run) now that the backend no longer withholds it. The
  // numbers are masked rather than shown at 0.00: a dash cannot be misread as
  // the robot standing on the map origin.
  const localized = state.localization_valid;

  return (
    <div className="divide-y divide-hairline">
      <InstrumentGroup
        label="Pose"
        caption={localized ? undefined : "The robot does not know where it is yet."}
      >
        <div className="mb-3 grid grid-cols-2 gap-3">
          <PrimaryReadout
            label="X"
            value={localized ? position.x.toFixed(2) : "—"}
            unit="m"
            tone={localized ? "live" : "neutral"}
          />
          <PrimaryReadout
            label="Y"
            value={localized ? position.y.toFixed(2) : "—"}
            unit="m"
            tone={localized ? "live" : "neutral"}
          />
        </div>
        <Readout
          label="Orientation"
          value={localized ? position.theta.toFixed(1) : "—"}
          unit="°"
          tone={localized ? "live" : "neutral"}
        />
        {/* No velocity row, by request. The field is still on the wire and in
          * the schema; the pose group is where the robot *is*, and how fast it
          * is going is a reading nobody watched here. */}
      </InstrumentGroup>

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
        * than watches. Pose and posture stay above the fold on a short rail. */}
      <MotorStatus motors={state.motor_status} />
    </div>
  );
}
