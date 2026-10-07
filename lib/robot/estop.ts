// The emergency stop's rules: when the console shows it as engaged, when this
// tab's own request stops counting, and how long a release has to be held.
// Kept pure so they are tested rather than remembered — a stop that reads as
// released while the robot reports its safety lock on is the one wrong
// answer this control can give.

/**
 * How long the release has to be held. Long enough that a press meant for the
 * stop — the button's other face, in the same place — cannot undo it on the
 * way past; short enough that an operator who means it is not left waiting.
 */
export const RELEASE_HOLD_MS = 1000;

/**
 * Whether the stop is shown as engaged.
 *
 * Two sources, and either is enough. `requested` is this tab's press, which
 * holds the drive controls and the dispatch buttons from the instant of the
 * press, before the robot has answered or the next 1 Hz frame has landed.
 * `locked` is the robot's reading (`low_level_mode.safety_locked`): a lock
 * engaged by another console or by the driver itself is engaged here too,
 * and null — no frame yet — is not evidence either way.
 */
export function estopEngaged(requested: boolean, locked: boolean | null): boolean {
  return requested || locked === true;
}

/**
 * This tab's request after one reading: dropped as soon as the robot reports
 * the lock on, because from then the reading is the whole truth.
 *
 * Kept past that point, the request would outlive the lock it asked for — a
 * release from another console would leave this tab showing a stop that is no
 * longer there, with nothing on the robot behind it. Until the reading
 * arrives it is what keeps the controls held across the poll gap. Returns
 * `requested` itself when nothing changes, so a caller adjusting React state
 * during render can compare by identity and settle.
 */
export function requestAfterReading(requested: boolean, locked: boolean | null): boolean {
  return requested && locked === true ? false : requested;
}
