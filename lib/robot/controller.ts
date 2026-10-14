// The commanded locomotion controller and the readings that overrule it. The
// controller cannot be read back (MPC has no motion code of its own), so the
// lit segment is a command; this is when the robot has plainly left it.

export type Controller = "RL" | "MPC";

/**
 * Motion code 8, no controller driving. Named, not `UNKNOWN`, because MPC's
 * code folds into `UNKNOWN` and this rule must tell them apart.
 */
export const IDLE_MOTION = "IDLE";

/** The motion label for code 1: the RL controller's own gait (`MODE C`). */
export const LOCOMOTION_MOTION = "LOCOMOTION";

/**
 * Readings that say MPC is not running: IDLE because the controller restarts
 * under RL, LOCOMOTION because it *is* RL (e.g. MPC pressed while lying, then
 * a stand).
 */
const NOT_MPC_MOTIONS: ReadonlySet<string> = new Set([IDLE_MOTION, LOCOMOTION_MOTION]);

/**
 * The commanded controller after one motion reading: an *arrival* at IDLE or
 * LOCOMOTION drops MPC to RL. The edge, not the level, so an MPC pressed while
 * already in one of them is not undone by the next poll before the robot acts.
 *
 * `prevMotion` is null before the first reading, which counts as a change.
 * Returns `commanded` itself when unchanged, so a render-time state
 * adjustment can settle by identity.
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
