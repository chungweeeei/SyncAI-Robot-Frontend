import type { GridStatus } from "@/lib/types/map";
import type { RobotMode } from "@/lib/types/robot";

/**
 * Whether a map may be written to right now, and if not, why.
 *
 * A map a running job names is read-only (see CLAUDE.md); the backend is the
 * gate, and this only greys the controls first. It reads each job's
 * `map_name`, never which map is active: that inference holds today but is
 * the backend's to make.
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
  // Fail closed: unknown is not idle. On an error `tasks` is the last good
  // list, which would miss a job started since.
  if (status !== "ok") return { locked: true, reason: RUN_LOCK_UNKNOWN };
  if (tasks.some((task) => task.map_name === mapName)) {
    return { locked: true, reason: RUN_LOCK_RUNNING };
  }
  return UNLOCKED;
}

export const DISPATCH_LOCK_CONVERTING =
  "This map's floor plan is being rebuilt. Wait for it to finish before sending the robot anywhere.";

/**
 * The other direction: whether a moving job may be sent onto a map. Not while
 * its floor plan is being rebuilt, since a route planned now would be planned
 * on the outgoing one. Stand and Lie down use no map and do not ask.
 */
export function dispatchMapLock(
  map: { grid_status: GridStatus } | null,
): RunLock {
  if (map?.grid_status === "converting") {
    return { locked: true, reason: DISPATCH_LOCK_CONVERTING };
  }
  return UNLOCKED;
}

export const AUTO_LOCALIZE_NOT_NAVIGATING =
  "The robot can only find itself on the map in Navigation mode.";
export const AUTO_LOCALIZE_JOB_RUNNING =
  "The robot is running a job. Cancel it or wait for it to finish before finding the robot.";
export const AUTO_LOCALIZE_UNKNOWN =
  "Can't confirm the robot is idle right now. Try again in a moment.";

/** What `autoLocalizeLock` reads off the two console-wide polls. */
export interface AutoLocalizeLockInput {
  /** The robot's mode from the last state frame; null before the first. */
  mode: RobotMode | null;
  tasks: readonly unknown[];
  status: "loading" | "ok" | "error";
}

/**
 * Whether Auto localize may be pressed, and if not, why.
 *
 * Any job locks it: a match moves the whole map frame, a jump mid-drive.
 * Mapping mode locks it since nothing listens there. The backend refuses both
 * anyway; an unknown mode is left to its refusal rather than guessed.
 */
export function autoLocalizeLock({
  mode,
  tasks,
  status,
}: AutoLocalizeLockInput): RunLock {
  if (mode !== null && mode !== "AUTO") {
    return { locked: true, reason: AUTO_LOCALIZE_NOT_NAVIGATING };
  }
  if (status !== "ok") return { locked: true, reason: AUTO_LOCALIZE_UNKNOWN };
  if (tasks.length > 0) return { locked: true, reason: AUTO_LOCALIZE_JOB_RUNNING };
  return UNLOCKED;
}
