// Which locomotion controller the console shows as commanded, and the one
// reading that is allowed to overrule it. The controller itself cannot be read
// back (MPC has no motion code the backend can name), so the lit segment is a
// command; this is the rule for when the robot has plainly left it, kept pure
// so the edge is tested and not remembered.

/** Which locomotion controller the gait controller should run. */
export type Controller = "RL" | "MPC";

/**
 * The motion label for code 8: the motors are not driven by any controller.
 * The backend names it rather than folding it into `UNKNOWN`, because MPC's
 * own code does fold into `UNKNOWN` and this rule has to tell the two apart.
 */
export const IDLE_MOTION = "IDLE";

/**
 * The commanded controller after one motion reading.
 *
 * A *return* to IDLE ends a commanded MPC: the motors have stopped, and the
 * controller comes back up under RL, so leaving MPC lit would claim a mode the
 * robot has dropped. It is the edge and not the level on purpose — an MPC
 * pressed while the robot is already idle has not been answered yet, and
 * resetting it on the very next poll would undo the operator's click before
 * the robot had a chance to act on it. RL is never touched: it is already
 * what IDLE falls back to.
 *
 * `prevMotion` is null before the first reading, which counts as not IDLE.
 * Returns `commanded` itself when nothing changes, so a caller adjusting React
 * state during render can compare by identity and settle.
 */
export function controllerAfterMotion(
  commanded: Controller,
  prevMotion: string | null,
  motion: string | null,
): Controller {
  if (commanded === "MPC" && motion === IDLE_MOTION && prevMotion !== IDLE_MOTION) {
    return "RL";
  }
  return commanded;
}
