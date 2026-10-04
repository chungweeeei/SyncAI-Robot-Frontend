import type { GridStatus } from "@/lib/types/map";

/**
 * Whether a map may be written to right now, and if not, the sentence that
 * says why.
 *
 * A job drives on the coordinates of one map, and a floor plan, a forbidden
 * zone or a waypoint changed under it is a change the planner picks up in the
 * middle of the run. So while any running job names a map, that map is
 * read-only. The backend is the gate — it refuses those writes for every
 * console and for a schedule nobody here started — and this rule is only how
 * the console greys the controls before a press would earn the refusal.
 *
 * It reads the map off each job (`map_name`, stamped by the backend) and never
 * infers it from which map is active. That inference happens to hold today,
 * because a switch is refused while a job runs, but it is the backend's to
 * make, and a console that made it too would keep locking the wrong map the
 * day the two stopped agreeing.
 */
export interface RunLock {
  locked: boolean;
  /** Why the map is locked, for the operator. Null when it is not. */
  reason: string | null;
}

/** The shape of `useActiveTasks`'s answer that this rule reads. */
export interface RunLockInput {
  /** The map being edited; null when there is none, which is never locked. */
  mapName: string | null;
  tasks: readonly { map_name: string | null }[];
  status: "loading" | "ok" | "error";
}

export const RUN_LOCK_RUNNING =
  "The robot is running a job on this map. Cancel it or wait for it to finish before changing the map.";
export const RUN_LOCK_UNKNOWN =
  "Can't confirm the robot is idle right now, so this map can't be changed. Try again in a moment.";

const UNLOCKED: RunLock = { locked: false, reason: null };

export function mapRunLock({ mapName, tasks, status }: RunLockInput): RunLock {
  if (mapName === null) return UNLOCKED;
  // Before the first answer and after a failed one, "no job" is not known —
  // and an unknown read as idle is how an edit lands under a moving robot.
  // `tasks` is the last good list on an error, which is exactly why it is
  // not consulted here: a job that started since would not be in it.
  if (status !== "ok") return { locked: true, reason: RUN_LOCK_UNKNOWN };
  if (tasks.some((task) => task.map_name === mapName)) {
    return { locked: true, reason: RUN_LOCK_RUNNING };
  }
  return UNLOCKED;
}

export const DISPATCH_LOCK_CONVERTING =
  "This map's floor plan is being rebuilt. Wait for it to finish before sending the robot anywhere.";

/**
 * The other direction: whether a job that drives may be sent onto a map.
 *
 * While a map's floor plan is being rebuilt the planner is about to be handed
 * a new one, so a route planned now is planned on a floor plan that is on its
 * way out. Only jobs that move are held — Stand and Lie down use no map, so
 * their callers do not ask.
 */
export function dispatchMapLock(
  map: { grid_status: GridStatus } | null,
): RunLock {
  if (map?.grid_status === "converting") {
    return { locked: true, reason: DISPATCH_LOCK_CONVERTING };
  }
  return UNLOCKED;
}
