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
