"use client";

import * as React from "react";

import {
  Chip,
  GroupToggle,
  InstrumentGroup,
  TONE_TEXT,
} from "@/components/console/instrument";
import { useRobotProfile } from "@/hooks/use-console-robot-state";
import { strayMotorLabels } from "@/lib/robot/motor-label";
import { cn } from "@/lib/utils";
import type { RobotMotorStatus } from "@/lib/types/robot";
import { motorTempTone } from "@/lib/robot/levels";

// A plan view, because a fault reads as "the hind-left leg is hot", not
// "HL_Knee_joint is 78". The legs and their rows are the robot's profile
// (lib/robot/profile.ts); the naming rule for the rest is lib/robot/motor-label.ts.

/** The worst thing in the set, as one chip. Faults outrank heat. */
function summaryChip(motors: RobotMotorStatus[]) {
  const faults = motors.filter((m) => m.error !== 0).length;
  if (faults > 0) {
    return <Chip tone="warn">{faults === 1 ? "1 fault" : `${faults} faults`}</Chip>;
  }

  const peak = Math.max(...motors.map((m) => m.temperature));
  return (
    <Chip tone={motorTempTone(peak)}>
      Max {peak}
      <span className="ml-0.5">°</span>
    </Chip>
  );
}

/** Whether anything in the set is worth opening the grid for. */
function needsAttention(motors: RobotMotorStatus[]): boolean {
  return motors.some((m) => m.error !== 0 || motorTempTone(m.temperature) !== "neutral");
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
          {/* Only when there is one: a column of E0 trains the eye to skip it. */}
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
 * Per-joint temperature and error code, the only motor fields the robot state
 * exposes. Polled at 1 Hz: fine for a leg warming over minutes, not faster.
 *
 * Folded to its chip and one sentence while every motor is normal: twelve
 * numbers that all say "fine" are what an operator watching a patrol for an
 * hour learns to skip, and a customer reads them as unfinished. It opens on
 * its own the moment a motor warms or faults — unless the operator closed it
 * since, which is theirs to decide — and Show opens it any time.
 */
export function MotorStatus({ motors }: { motors: RobotMotorStatus[] }) {
  const byName = new Map(motors.map((m) => [m.name, m]));
  const gridId = React.useId();
  const attention = needsAttention(motors);
  const [chosen, setChosen] = React.useState<boolean | null>(null);
  const open = chosen ?? attention;

  // Joints the layout does not know (the driver's naming is still unsettled,
  // or the robot is a kind this console has no grid for): listed rather than
  // silently dropped from the grid.
  const grid = useRobotProfile()?.motorGrid ?? [];
  const placed = new Set(grid.flatMap((leg) => leg.motors.map((m) => m.name)));
  const strays = motors.filter((m) => !placed.has(m.name));
  const strayLabels = strayMotorLabels(strays.map((m) => m.name));

  return (
    <InstrumentGroup
      label="Motors"
      action={
        motors.length > 0 ? (
          <span className="flex items-center gap-1.5">
            {summaryChip(motors)}
            <GroupToggle
              open={open}
              onToggle={() => setChosen(!open)}
              controls={gridId}
              what="motor temperatures"
            />
          </span>
        ) : undefined
      }
    >
      {motors.length === 0 ? (
        <p className="text-[12px] leading-snug text-muted-foreground">
          No motor readings from the robot.
        </p>
      ) : !open ? (
        <p id={gridId} className="text-[12px] leading-snug text-muted-foreground">
          {attention
            ? "A motor needs attention. Show the joints to see which."
            : `All ${motors.length} motors are within limits.`}
        </p>
      ) : (
        <div id={gridId}>
          {grid.length > 0 && (
            <div className="grid grid-cols-2 gap-x-5 gap-y-3">
              {grid.map((leg) => (
                <div key={leg.label}>
                  <div className="mb-1 text-[12px] font-medium text-foreground">
                    {leg.label}
                  </div>
                  <div className="space-y-1">
                    {leg.motors.map((motor) => (
                      <JointRow
                        key={motor.name}
                        label={motor.label}
                        motor={byName.get(motor.name)}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {strays.length > 0 && (
            <div
              className={cn(
                "space-y-1",
                grid.length > 0 && "mt-3 border-t border-hairline pt-2.5",
              )}
            >
              {strays.map((motor, index) => (
                <JointRow
                  key={motor.name}
                  label={strayLabels[index]}
                  motor={motor}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </InstrumentGroup>
  );
}
