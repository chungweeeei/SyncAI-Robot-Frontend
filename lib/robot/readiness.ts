// What the console makes of the robot's state machine: how each state reads,
// which jobs it holds back, and what an operator may do about it.
//
// The robot is the judge. It refuses a job at its own door (and the backend
// answers 409 `error_latched` / `not_initialized` before that), so every lock
// here only greys a press that could not have worked and says why first.

import type { RunLock } from "@/lib/map/run-lock";
import type { ReadStatus } from "@/lib/types/read";
import type { RobotMode, RobotStatus } from "@/lib/types/robot";
import type { Tone } from "@/lib/types/tone";

/**
 * Whether the robot's frame comes from a backend with the state machine.
 * `localization_converged` arrived with it, so its presence is the test. On a
 * frame without it `state` is the older rollup, where UNINITIALIZED meant
 * only "no pose yet" and nothing was refused for it: the console then gates
 * nothing and offers no control, since a press would have nowhere to go.
 */
export function gateSupported(frame: { localization_converged?: boolean }): boolean {
  return frame.localization_converged !== undefined;
}

/**
 * What the console may say about the robot's state right now:
 *
 * - `none`: nothing to draw. No frame has ever arrived, or it is from a
 *   backend before the state machine.
 * - `silent`: the robot has a state machine and is not reporting it. The
 *   console holds a last frame (the poll keeps it through a failure), but
 *   that is a memory: the robot may have failed a job, or been restarted
 *   unconfirmed, since. Its word is not shown and nothing is offered on it.
 * - `live`: the word of a frame the poll has just renewed.
 */
export type StateReading =
  | { kind: "none" }
  | { kind: "silent" }
  | { kind: "live"; state: RobotStatus };

/**
 * A frame the poll has not renewed is not a reading. The robot's state is
 * the one field of the frame the console lets an operator act on — confirm
 * a position, release an error — so it alone is withheld while the poll
 * fails; the robot id, the map and the pose keep showing their last value,
 * as they always have, beside the masthead's link chip that says so.
 *
 * `supported` is still read off the last frame: it is a fact about the
 * backend, which a silent robot does not change.
 */
export function stateReading({
  frame,
  status,
}: {
  /** What the last frame said; undefined before the first. */
  frame: { supported: boolean; state: RobotStatus | null } | undefined;
  /** How the robot-state poll stands. */
  status: ReadStatus;
}): StateReading {
  if (!frame || !frame.supported) return { kind: "none" };
  if (status !== "ok") return { kind: "silent" };
  return frame.state === null ? { kind: "none" } : { kind: "live", state: frame.state };
}

/** The chip's word while the robot's state is not being reported: the dash of every unread instrument. */
export const STATE_SILENT_LABEL = "—";
/** The same for a screen reader and the hover text, which a dash does not say. */
export const STATE_SILENT_NAME = "not reported";
/** Said when the failure carries no sentence of the backend's own. */
export const STATE_SILENT =
  "The robot's state cannot be read right now.";

export interface RobotStatusView {
  /** The word on the masthead's chip. */
  label: string;
  tone: Tone;
  /**
   * Drawn as a framed, filled chip rather than a dot and a word: the two
   * states an operator has to act on before the robot takes a job
   * (Unconfirmed, Error). Everything else is said quietly.
   */
  loud: boolean;
  /**
   * What the state means, for when the robot adds no sentence of its own
   * (`state_message` is empty for the states their name already explains).
   * Null for a word the console does not know.
   */
  detail: string | null;
}

/**
 * RUNNING takes the running job bar's hue (the task chip's IN_PROGRESS), so
 * the chip and the bar beside it are one colour for one fact. CHARGING is
 * `live`, as the battery's bolt is.
 *
 * WARNING reads "Low battery" because that is its one cause today and the
 * robot sends no sentence with it; a second cause needs a word of its own
 * here before it ships.
 */
const VIEWS: Readonly<Record<string, RobotStatusView>> = {
  IDLE: {
    label: "Idle",
    tone: "live",
    loud: false,
    detail: "The robot's position is confirmed and it can take jobs.",
  },
  RUNNING: { label: "Running", tone: "active", loud: false, detail: "The robot is running a job." },
  UNINITIALIZED: {
    label: "Unconfirmed",
    tone: "caution",
    loud: true,
    detail:
      "Nobody has confirmed where the robot is on the map, so it will not take a job that drives on it.",
  },
  WARNING: {
    label: "Low battery",
    tone: "caution",
    loud: false,
    detail: "The battery is low. The robot still takes jobs.",
  },
  ERROR: {
    label: "Error",
    tone: "warn",
    loud: true,
    detail: "A job failed. The robot takes no job until this is released.",
  },
  CHARGING: { label: "Charging", tone: "live", loud: false, detail: "The robot is on its charger." },
};

/**
 * A state as the operator reads it. `state` is an open string (the backend
 * answers UNKNOWN for a code it cannot name, and a newer robot may have a
 * state this console predates), so an unknown word is shown as itself, in no
 * hue: guessing a meaning for it would be a claim about the robot.
 */
export function robotStatusView(state: RobotStatus): RobotStatusView {
  return VIEWS[state] ?? { label: state, tone: "neutral", loud: false, detail: null };
}

const UNLOCKED: RunLock = { locked: false, reason: null };

export const START_LOCK_ERROR =
  "A job failed, and the robot takes no job until that is released. Release it from the robot's state in the top bar.";
export const START_LOCK_UNCONFIRMED =
  "The robot's position is not confirmed, so it will not drive on the map. Confirm it from the robot's state in the top bar.";
export const START_LOCK_SILENT =
  "The robot is not reporting its state, so this stays held as it last reported until it does.";

/**
 * Whether a job may be started, given the robot's state — the backend's
 * advisory refusal, mirrored: ERROR holds every job, UNINITIALIZED the ones
 * that drive on the map (`needsLocalization` in lib/task/step.ts), and a
 * posture, a spoken line or a wait still runs on an unconfirmed robot.
 *
 * Fails open. A state this console does not know, no frame yet, or a backend
 * without the gate locks nothing: the robot's own refusal still answers the
 * press, and a console that guessed "held" would take away the one way to
 * send the robot anywhere on the strength of a word it could not read.
 *
 * A frame the poll no longer renews (`silent`) is judged the same way — a
 * hold it last reported stays, a press it allowed goes through — but the
 * reason does not repeat its word: the state chip shows a dash then, and a
 * line saying "not confirmed" or "a job failed" beside it would be a reading
 * the console has just declined to show.
 */
export function startLock({
  state,
  supported,
  needsLocalization,
  silent = false,
}: {
  /** The rollup from the last frame; null or undefined before the first. */
  state: RobotStatus | null | undefined;
  /** `gateSupported` of that frame. */
  supported: boolean;
  needsLocalization: boolean;
  /** The robot has stopped reporting: `state` is the last frame's, a memory. */
  silent?: boolean;
}): RunLock {
  if (!supported) return UNLOCKED;
  const held =
    state === "ERROR"
      ? START_LOCK_ERROR
      : state === "UNINITIALIZED" && needsLocalization
        ? START_LOCK_UNCONFIRMED
        : null;
  if (held === null) return UNLOCKED;
  return { locked: true, reason: silent ? START_LOCK_SILENT : held };
}

export const STATE_CHANGE_JOB_RUNNING =
  "The robot is running a job. Cancel it or wait for it to finish first.";
export const STATE_CHANGE_UNKNOWN =
  "Whether a job is running cannot be read right now. Try again in a moment.";
export const CONFIRM_NOT_NAVIGATING =
  "The robot's position can only be confirmed in Navigation mode.";
export const CONFIRM_NOT_CONVERGED =
  "The robot has not found its position on the map yet. Set an initial pose or use Auto localize on the dashboard first.";

/** What the two locks below read off the active-tasks poll. */
interface JobListInput {
  tasks: readonly unknown[];
  status: ReadStatus;
}

/**
 * Whether the robot's state may be changed by hand at all: not while a job
 * runs (409 `task_running`), and not while the job list cannot be read (409
 * `tasks_unknown`). Fails closed, as `autoLocalizeLock` does and for its
 * reason: on an error the list is the last good one, which would miss a job
 * started since — and a release pressed under a running job is the one press
 * here that could let a second job start beside it.
 */
export function stateChangeLock({ tasks, status }: JobListInput): RunLock {
  if (status !== "ok") return { locked: true, reason: STATE_CHANGE_UNKNOWN };
  if (tasks.length > 0) return { locked: true, reason: STATE_CHANGE_JOB_RUNNING };
  return UNLOCKED;
}

/**
 * Whether the position may be confirmed, and if not, why. On top of
 * `stateChangeLock`: only in Navigation mode (a mapping run has no map to be
 * on), and only once the robot's last guess has settled (409
 * `not_converged`) — there is no estimate to confirm before that. An unknown
 * mode is left to the backend's refusal rather than guessed.
 *
 * `converged` says the press is possible, never that the position is right:
 * that is what the operator is confirming.
 */
export function confirmLock({
  converged,
  mode,
  tasks,
  status,
}: JobListInput & {
  converged: boolean;
  /** The robot's mode from the last frame; null before the first. */
  mode: RobotMode | null;
}): RunLock {
  if (mode !== null && mode !== "AUTO") return { locked: true, reason: CONFIRM_NOT_NAVIGATING };
  const change = stateChangeLock({ tasks, status });
  if (change.locked) return change;
  if (!converged) return { locked: true, reason: CONFIRM_NOT_CONVERGED };
  return UNLOCKED;
}

/** What POST /api/v1/robot/state may be asked for. */
export type RobotStateTarget = "IDLE" | "UNINITIALIZED";

/**
 * How long the robot must report RUNNING over a readable, empty job list
 * before the console calls the job stuck. Longer than both polls together
 * (1 s and 2 s), so a job that has only just started or ended, seen by one
 * poll and not yet the other, is never offered for clearing.
 */
export const STUCK_JOB_AFTER_MS = 5_000;

/**
 * Whether the robot counts a job as running that the job list does not have:
 * a run ended from outside never reports its end, and the robot would refuse
 * every later job as busy. The caller holds this for `STUCK_JOB_AFTER_MS`
 * before offering to clear it. An unreadable list is not an empty one.
 */
export function stuckJobSuspected({
  state,
  tasks,
  status,
}: JobListInput & { state: RobotStatus | null | undefined }): boolean {
  return state === "RUNNING" && status === "ok" && tasks.length === 0;
}

export interface StateAction {
  id: "confirm" | "withdraw" | "release-confirm" | "clear-stuck";
  label: string;
  target: RobotStateTarget;
  /** Why it cannot be pressed right now, or null. */
  lock: string | null;
}

export const STUCK_JOB_NOTE =
  "The robot still counts a job as running, but none is listed. Clearing it lets the robot take jobs again.";

/**
 * The one control the robot's state offers an operator, or null — and with
 * it, whether the state opens at all (the masthead's chip is a button only
 * where this answers one):
 *
 * - UNINITIALIZED: confirm the position.
 * - ERROR: release it and confirm the position, needing a settled guess. No
 *   release that leaves the position unconfirmed, by decision: a robot that
 *   failed a job is looked at before it takes another, and that look is the
 *   confirmation (Set initial pose first, if the guess has not settled).
 * - IDLE: withdraw the confirmation.
 * - RUNNING: nothing — a job is ended from its own controls — unless it is
 *   `stuck`, when clearing it is the recovery. That keeps the confirmation
 *   the job ran under where the robot's guess still stands, and drops it
 *   otherwise, since confirming needs a settled guess.
 * - CHARGING, WARNING and any other word: nothing. Charging and a low
 *   battery are said, not acted on here; and the console does not know what
 *   an unknown word would undo.
 */
export function stateAction({
  state,
  converged,
  mode,
  tasks,
  status,
  stuck,
}: JobListInput & {
  state: RobotStatus;
  converged: boolean;
  mode: RobotMode | null;
  /** `stuckJobSuspected` has held for `STUCK_JOB_AFTER_MS`. */
  stuck: boolean;
}): StateAction | null {
  const confirm = confirmLock({ converged, mode, tasks, status }).reason;
  switch (state) {
    case "UNINITIALIZED":
      return { id: "confirm", label: "Confirm position", target: "IDLE", lock: confirm };
    case "ERROR":
      return {
        id: "release-confirm",
        label: "Release and confirm position",
        target: "IDLE",
        lock: confirm,
      };
    case "IDLE":
      return {
        id: "withdraw",
        label: "Mark unconfirmed",
        target: "UNINITIALIZED",
        lock: stateChangeLock({ tasks, status }).reason,
      };
    case "RUNNING":
      return stuck
        ? {
            id: "clear-stuck",
            label: "Clear the stuck job",
            target: converged ? "IDLE" : "UNINITIALIZED",
            // `stuck` already says the list is readable and empty.
            lock: null,
          }
        : null;
    default:
      return null;
  }
}

export const INITIAL_POSE_JOB_RUNNING =
  "A job is running. Set initial pose and Auto localize open once it ends.";

/**
 * Whether Set initial pose may be armed. A new pose moves the whole map
 * frame under a job, and withdraws the confirmation the job runs on, so the
 * backend refuses it while one runs (409 `task_running` / `tasks_unknown`).
 * Fails closed with it, as Auto localize beside it does.
 */
export function initialPoseLock({ tasks, status }: JobListInput): RunLock {
  if (status !== "ok") return { locked: true, reason: STATE_CHANGE_UNKNOWN };
  if (tasks.length > 0) return { locked: true, reason: INITIAL_POSE_JOB_RUNNING };
  return UNLOCKED;
}
