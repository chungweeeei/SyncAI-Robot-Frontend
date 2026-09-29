/**
 * When a restart of the robot's software can be said to be over.
 *
 * A mode switch knows it has landed because `mode` changes; a restart
 * rebuilds the mode already live, so the state frame looks the same before
 * and after and cannot say it on its own. What does change is the poll's
 * health: the backend is one of the processes the restart tears down, so the
 * poll has to fail at least once and then succeed again. Both halves are
 * needed — a success alone may be a frame the old stack answered in the
 * second before it went down.
 *
 * All three times are the browser's clock (`Date.now()` in the press
 * handler, TanStack's `dataUpdatedAt` / `errorUpdatedAt`), so they compare.
 */
export interface RestartClock {
  /** When the restart was requested, or null if none is outstanding. */
  requestedAt: number | null;
  /** The last successful state frame, or null before the first. */
  updatedAt: number | null;
  /** The last failed state poll, or null if none ever failed. */
  lastErrorAt: number | null;
}

/**
 * How long a requested restart may go without the link ever dropping before
 * it stops being shown as in progress. The rebuild takes 10–30 s and the drop
 * comes first, within the backend's 2 s ack window; two minutes of unbroken
 * frames means the stack was not torn down, and a chip that said
 * "Restarting" forever would be a claim nothing supports any more.
 */
export const RESTART_GIVE_UP_MS = 120_000;

export function restartPending({
  requestedAt,
  updatedAt,
  lastErrorAt,
}: RestartClock): boolean {
  if (requestedAt === null) return false;
  const droppedSince = lastErrorAt !== null && lastErrorAt > requestedAt;
  if (droppedSince) {
    return updatedAt === null || updatedAt <= lastErrorAt;
  }
  // Measured on the poll's own clock rather than Date.now() in render: the
  // 1 Hz frames are what re-render this anyway, and a render that reads the
  // wall clock is not a pure one.
  return updatedAt === null || updatedAt - requestedAt < RESTART_GIVE_UP_MS;
}
