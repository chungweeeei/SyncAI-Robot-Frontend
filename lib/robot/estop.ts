// The emergency stop's rules, kept pure so they are tested: a stop that reads
// released while the robot reports its safety lock is the one wrong answer.

/**
 * Long enough that a press meant for the stop (same button, same place)
 * cannot undo it on the way past.
 */
export const RELEASE_HOLD_MS = 1000;

/**
 * Whether the stop is shown as engaged; either source is enough. `requested`
 * is this tab's press, which holds the controls before the next 1 Hz frame.
 * `locked` is the robot's `safety_locked`, so a lock from another console
 * counts too; null (no frame yet) is not evidence either way.
 */
export function estopEngaged(requested: boolean, locked: boolean | null): boolean {
  return requested || locked === true;
}

/**
 * This tab's request after one reading: dropped once the robot reports the
 * lock, or a release from another console would leave this tab showing a stop
 * that is gone. Returns `requested` itself when unchanged, so a render-time
 * state adjustment can settle by identity.
 */
export function requestAfterReading(requested: boolean, locked: boolean | null): boolean {
  return requested && locked === true ? false : requested;
}

/**
 * What the strip's stop line says, if anything. The icon alone carried every
 * one of these before, and a red square is not a sentence: a customer shown
 * the screen could not tell a stopped robot from a running one, and a press
 * the robot refused said so only in a tooltip a finger never opens.
 *
 * - `refused`: the last engage was refused and nothing is locked — the one
 *   case where silence would let an operator believe the robot had stopped.
 * - `release-refused`: the last release was refused; still stopped.
 * - `releasing`: a release is on its way; the reading decides when it is done.
 * - `stopping`: this tab pressed, the robot has not reported the lock yet.
 * - `stopped`: the robot reports its safety lock, whoever pressed.
 *
 * A refusal outranks the state, since it is news the state does not carry;
 * an engage refused while another console's lock holds is not news at all.
 */
export type EstopLine = "refused" | "release-refused" | "releasing" | "stopping" | "stopped";

export function estopLine({
  engaged,
  confirmed,
  releasing,
  refusedRequest,
}: {
  engaged: boolean;
  /** The robot's own reading says locked. */
  confirmed: boolean;
  releasing: boolean;
  /** The request the last refusal answered: true an engage, false a release, null none. */
  refusedRequest: boolean | null;
}): EstopLine | null {
  if (refusedRequest === true && !engaged) return "refused";
  if (refusedRequest === false && engaged) return "release-refused";
  if (releasing) return "releasing";
  if (engaged) return confirmed ? "stopped" : "stopping";
  return null;
}
