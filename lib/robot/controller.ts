// Which locomotion controller the console shows as commanded, and the two
// readings that are allowed to overrule it. The controller itself cannot be read
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

/** The motion label for code 1: the RL controller's own gait (`MODE C`). */
export const LOCOMOTION_MOTION = "LOCOMOTION";

/**
 * Readings that say MPC is not what is running. IDLE because the controller
 * comes back up under RL once the motors stop; LOCOMOTION because it *is* RL —
 * an MPC pressed while the robot lay down, then a stand, lands here, and the
 * robot is walking under RL whatever the console last sent.
 */
const NOT_MPC_MOTIONS: ReadonlySet<string> = new Set([IDLE_MOTION, LOCOMOTION_MOTION]);

/**
 * The commanded controller after one motion reading.
 *
 * An *arrival* at IDLE or LOCOMOTION ends a commanded MPC (see
 * `NOT_MPC_MOTIONS`), so leaving MPC lit would claim a mode the robot has
 * dropped. It is the edge and not the level on purpose — an MPC pressed while
 * the robot already reads one of the two has not been answered yet, and
 * resetting it on the very next poll would undo the operator's click before
 * the robot had a chance to act on it. RL is never touched: it is already
 * what both readings mean.
 *
 * `prevMotion` is null before the first reading, which counts as a change.
 * Returns `commanded` itself when nothing changes, so a caller adjusting React
 * state during render can compare by identity and settle.
 */
export function controllerAfterMotion(
  commanded: Controller,
  prevMotion: string | null,
  motion: string | null,
): Controller {
  if (
    commanded === "MPC" &&
    motion !== null &&
    NOT_MPC_MOTIONS.has(motion) &&
    prevMotion !== motion
  ) {
    return "RL";
  }
  return commanded;
}
