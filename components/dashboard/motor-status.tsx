"use client";

import {
  Chip,
  InstrumentGroup,
  TONE_TEXT,
} from "@/components/console/instrument";
import { JOINTS, LEG_ROWS, jointName, strayMotorLabels } from "@/lib/robot/motor-label";
import { cn } from "@/lib/utils";
import type { RobotMotorStatus } from "@/lib/types/robot";
import { motorTempTone } from "@/lib/robot/levels";

// Plan view of the chassis, laid out rather than listed because that is how
// the fault reads — "the hind-left leg is hot", not "HL_Knee_joint is 78" —
// and it matches the robot the operator sees in the viewport beside this. The
// legs, the joint codes and the naming rule live in lib/robot/motor-label.ts.

/** The worst thing in the set, as one chip. Faults outrank heat. */
function summaryChip(motors: RobotMotorStatus[]) {
  const faults = motors.filter((m) => m.error !== 0).length;
  if (faults > 0) {
    return <Chip tone="warn">{faults} FAULT</Chip>;
  }

  const peak = Math.max(...motors.map((m) => m.temperature));
  return (
    <Chip tone={motorTempTone(peak)}>
      MAX {peak}
      <span className="ml-0.5">°</span>
    </Chip>
  );
}

function JointRow({
  label,
  motor,
}: {
  label: string;
  motor?: RobotMotorStatus;
}) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="instrument-label text-muted-foreground">{label}</span>
      {motor ? (
        <span className="flex items-baseline gap-1.5">
          {/* The error code only appears when there is one: a column of E0 down
           * every leg would train the eye to skip exactly the field that
           * matters. */}
          {motor.error !== 0 && (
            <span className="readout text-[11px] text-signal-warn">
              E{motor.error}
            </span>
          )}
          <span
            className={cn(
              "readout text-[13px] font-medium",
              TONE_TEXT[
                motor.error !== 0 ? "warn" : motorTempTone(motor.temperature)
              ],
            )}
          >
            {motor.temperature}
            <span className="text-[11px] font-normal text-muted-foreground">
              °
            </span>
          </span>
        </span>
      ) : (
        <span className="readout text-[13px] text-muted-foreground">—</span>
      )}
    </div>
  );
}

/**
 * Per-joint motor health from GET /api/v1/robot/state: twelve actuators as the
 * robot's own plan view, so heat and faults read as a place on the machine.
 *
 * Only temperature and the error code are here because that is all the
 * endpoint exposes — the kinematic half of MotorState is deliberately internal
 * (see the backend router). This is a 10 Hz snapshot polled at 1 Hz: fine for
 * watching a leg warm up over minutes, useless for anything faster.
 */
export function MotorStatus({ motors }: { motors: RobotMotorStatus[] }) {
  const byName = new Map(motors.map((m) => [m.name, m]));

  // Anything the four-leg layout does not account for. kJointNames in
  // syncai_driver_manager.cpp still carries a TODO about its ordering, so a
  // renamed joint is a live possibility — list the strays rather than drop
  // them, which would silently shrink the grid to eleven readings.
  const placed = new Set(
    LEG_ROWS.flat().flatMap((leg) =>
      JOINTS.map((j) => jointName(leg, j.suffix)),
    ),
  );
  const strays = motors.filter((m) => !placed.has(m.name));
  const strayLabels = strayMotorLabels(strays.map((m) => m.name));

  return (
    <InstrumentGroup
      label="Motors"
      action={motors.length > 0 ? summaryChip(motors) : undefined}
    >
      {motors.length === 0 ? (
        <p className="text-[11px] leading-snug text-muted-foreground">
          No motor readings from the robot.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3">
            {LEG_ROWS.flat().map((leg) => (
              <div key={leg}>
                <div className="instrument-label mb-1 text-muted-foreground">
                  {leg}
                </div>
                <div className="space-y-1">
                  {JOINTS.map((joint) => (
                    <JointRow
                      key={joint.suffix}
                      label={joint.label}
                      motor={byName.get(jointName(leg, joint.suffix))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {strays.length > 0 && (
            <div className="mt-3 space-y-1 border-t border-hairline pt-2.5">
              {strays.map((motor, index) => (
                <JointRow
                  key={motor.name}
                  label={strayLabels[index]}
                  motor={motor}
                />
              ))}
            </div>
          )}
        </>
      )}
    </InstrumentGroup>
  );
}
