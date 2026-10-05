// When the masthead interrupts an operator about a hot motor, and when it is
// allowed to do so again. The thresholds are lib/robot/levels.ts's; this is
// the rule that turns a stream of 1 Hz readings into one notice rather than
// one per frame, kept pure so the edges are tested and not remembered.

import { TEMP_ALERT_C, TEMP_WARN_C } from "@/lib/robot/levels";
import type { RobotMotorStatus } from "@/lib/types/robot";

/**
 * The notice's lifecycle.
 *
 * - `clear`: nothing is over the limit and the notice is armed.
 * - `raised`: a motor crossed `TEMP_ALERT_C` and the notice is on screen.
 * - `dismissed`: the operator closed it, and the motor is still hot.
 *
 * There is no timer in here. The gridmap editor's save notes say why no
 * message that matters auto-dismisses in this console, and a motor over its
 * limit matters more than a save.
 */
export type HeatAlertPhase = "clear" | "raised" | "dismissed";

/**
 * The phase after one reading of the hottest motor.
 *
 * Raised on the crossing, strictly above the limit. Cleared — which is also
 * what re-arms a dismissed notice — only once the peak has fallen back under
 * the red readout's own threshold, five degrees lower: a joint hovering at
 * 85/86 would otherwise raise, clear and raise again on every poll, and a
 * notice that flickers is one that gets dismissed without being read. No
 * reading at all clears too, so a robot that drops off the air takes its
 * notice with it rather than leaving a stale one up.
 *
 * Returns `prev` itself when nothing changes, so a caller adjusting React
 * state during render can compare by identity and settle.
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
 * The motor the notice names: the hottest, first one listed on a tie, and
 * none when the robot reports no motors. Faults are not weighed here — the
 * grid's summary chip already ranks a fault above heat, and this notice is
 * about one thing.
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
