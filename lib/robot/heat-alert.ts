// Turns 1 Hz motor readings into one overheating notice rather than one per
// frame. Thresholds are lib/robot/levels.ts's.

import { TEMP_ALERT_C, TEMP_WARN_C } from "@/lib/robot/levels";
import type { RobotMotorStatus } from "@/lib/types/robot";

/**
 * The notice's lifecycle.
 *
 * - `clear`: nothing is over the limit and the notice is armed.
 * - `raised`: a motor crossed `TEMP_ALERT_C` and the notice is on screen.
 * - `dismissed`: the operator closed it, and the motor is still hot.
 *
 * No timer: nothing that matters auto-dismisses in this console.
 */
export type HeatAlertPhase = "clear" | "raised" | "dismissed";

/**
 * The phase after one reading of the hottest motor.
 *
 * Raised strictly above the limit; cleared (and re-armed) only below the red
 * threshold five degrees lower, so a joint hovering at 85/86 does not make it
 * flicker. No reading clears too, so a robot that drops off takes its notice
 * with it. Returns `prev` itself when unchanged, so a render-time state
 * adjustment can settle by identity.
 */
export function nextHeatAlertPhase(
  prev: HeatAlertPhase,
  peak: number | undefined,
): HeatAlertPhase {
  if (peak === undefined || peak < TEMP_WARN_C) return "clear";
  if (prev === "clear" && peak > TEMP_ALERT_C) return "raised";
  return prev;
}

/**
 * The hottest motor (first on a tie). Faults are not weighed: the grid's
 * summary chip already ranks them.
 */
export function hottestMotor(
  motors: readonly RobotMotorStatus[],
): RobotMotorStatus | undefined {
  let hottest: RobotMotorStatus | undefined;
  for (const motor of motors) {
    if (!hottest || motor.temperature > hottest.temperature) hottest = motor;
  }
  return hottest;
}
