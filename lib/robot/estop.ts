// The emergency stop's two rules: when the console shows it as engaged, and
// how long a release has to be held. Kept pure so both are tested rather than
// remembered — a stop that reads as released while the robot reports ESTOP is
// the one wrong answer this control can give.

/** The motion label the robot reports while its emergency stop is in force. */
export const ESTOP_MOTION = "ESTOP";

/**
 * How long the release has to be held. Long enough that a press meant for the
 * stop — the button's other face, in the same place — cannot undo it on the
 * way past; short enough that an operator who means it is not left waiting.
 */
export const RELEASE_HOLD_MS = 1000;

/**
 * Whether the stop is shown as engaged.
 *
 * Two sources, and either is enough. `latched` is this tab's own request, which
 * holds the drive controls and the dispatch buttons whatever the robot answers.
 * `motion` is the robot's reading: an ESTOP reported there is engaged even in a
 * tab that never pressed the button (another console did, or the robot's own
 * remote), and releasing this tab's latch cannot make it read otherwise.
 */
export function estopEngaged(latched: boolean, motion: string | null): boolean {
  return latched || motion === ESTOP_MOTION;
}
