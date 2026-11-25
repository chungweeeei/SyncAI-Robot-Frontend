import * as z from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { normalizeTheta } from "@/lib/angle";
import type { RobotStateTarget } from "@/lib/robot/readiness";
import { RobotStateSchema } from "@/lib/types/robot";
import type { PlanarPose, RobotState, RobotStatus } from "@/lib/types/robot";

/**
 * Why the backend has no current frame to give, by its 404's code: the robot
 * has not reported its state yet (`robot_state_unavailable`), or reported it
 * and then stopped (`robot_state_stale` — the backend serves a frame only
 * while the robot keeps renewing it, about every second).
 */
export type RobotStateSilentCode = "robot_state_unavailable" | "robot_state_stale";

const ROBOT_STATE_SILENT_CODES: readonly string[] = [
  "robot_state_unavailable",
  "robot_state_stale",
];

/**
 * The robot is not reporting its state. Typed apart from every other failed
 * read because its sentence is the backend's, written for an operator ("The
 * robot has not reported its state for 4 seconds."), and so may be shown —
 * where a dropped connection's or a mis-shaped frame's is an engineer's.
 */
export class RobotStateSilentError extends Error {
  code: RobotStateSilentCode;

  constructor(message: string, code: RobotStateSilentCode) {
    super(message);
    this.name = "RobotStateSilentError";
    this.code = code;
  }
}

/**
 * The backend's own sentence for a robot that is not reporting its state, or
 * null: for no failure at all, and for one that is not the backend's to word.
 */
export function robotStateSilence(error: Error | null | undefined): string | null {
  return error instanceof RobotStateSilentError ? error.message : null;
}

/**
 * The console's 1 Hz machine snapshot. 404 until the robot's first frame,
 * and again once the robot has not renewed it for a few seconds — a frame is
 * only ever the robot's current word (`RobotStateSilentError`). Not a source
 * of motion (whole-second stamps, a frozen third-party contract): the 3D
 * viewer reads the telemetry socket.
 */
export function fetchRobotState(signal?: AbortSignal): Promise<RobotState> {
  return requestJson<RobotState>(apiUrl("/api/v1/robot/state"), {
    signal,
    schema: RobotStateSchema,
    mapError: ({ detail, code }, res) =>
      res.status === 404 && code && ROBOT_STATE_SILENT_CODES.includes(code)
        ? new RobotStateSilentError(detail, code as RobotStateSilentCode)
        : undefined,
  });
}

/**
 * The state change's 409 codes, each temporary in its own way: a job has to
 * end (`task_running`), the job list has to be readable again
 * (`tasks_unknown`), the robot has to find its position first
 * (`not_converged`, whose sentence is the robot's own), or the robot refused
 * for a reason of its own (`robot_state_refused`).
 */
export type RobotStateConflictCode =
  | "task_running"
  | "tasks_unknown"
  | "not_converged"
  | "robot_state_refused";

const ROBOT_STATE_CONFLICT_CODES: readonly string[] = [
  "task_running",
  "tasks_unknown",
  "not_converged",
  "robot_state_refused",
];

export class RobotStateConflictError extends Error {
  code: RobotStateConflictCode;

  constructor(message: string, code: RobotStateConflictCode) {
    super(message);
    this.name = "RobotStateConflictError";
    this.code = code;
  }
}

export interface SetRobotStateResult {
  /**
   * The state the robot reports after the change, which is not always the
   * one asked for: the rollup answers CHARGING for a confirmed robot on its
   * charger. Open, as `RobotState.state` is.
   */
  state: RobotStatus;
  /** Operator-facing; render verbatim. */
  message: string;
}

const SetRobotStateResultSchema: z.ZodType<SetRobotStateResult> = z.object({
  state: z.string(),
  message: z.string(),
});

/**
 * The operator's switch on the robot's state machine. `IDLE` confirms the
 * robot's position — the only way a job that drives on the map may start —
 * and `UNINITIALIZED` withdraws that confirmation; either one also releases
 * a latched error, and clears a job the robot still counts as running after
 * its run was ended from outside.
 *
 * A 409 carries one of `RobotStateConflictCode`; a 502 means the robot did
 * not answer and nothing changed. The answer is a receipt: the reading is
 * the next `GET /robot/state`.
 */
export function setRobotState(target: RobotStateTarget): Promise<SetRobotStateResult> {
  return requestJson<SetRobotStateResult>(apiUrl("/api/v1/robot/state"), {
    method: "POST",
    body: JSON.stringify({ state: target }),
    schema: SetRobotStateResultSchema,
    mapError: ({ detail, code }, res) =>
      res.status === 409 && code && ROBOT_STATE_CONFLICT_CODES.includes(code)
        ? new RobotStateConflictError(detail, code as RobotStateConflictCode)
        : undefined,
  });
}

/**
 * An initial pose, with the ground height of the floor it was placed on when
 * one was picked. Without `z` the localizer keeps the storey it is on.
 */
export type InitialPose = PlanarPose & { z?: number };

/**
 * Seed localization with an operator pose (RViz's "2D Pose Estimate"). Fire
 * and forget: a 200 means it was sent, not that localization converged — the
 * pose feed moving to the marker is the answer. It also withdraws an
 * operator's confirmation of the position, which is why the backend refuses
 * it while a job runs (409 `task_running` / `tasks_unknown`).
 *
 * `z` is sent whenever it is set, 0 included: unlike a goal's, a missing one
 * is not the ground floor but "the storey the localizer thinks it is on",
 * which is the very guess a seed onto the ground floor has to overrule.
 */
export async function setInitialPose(pose: InitialPose): Promise<void> {
  await requestJson<void>(apiUrl("/api/v1/robot/set_initial_pose"), {
    method: "POST",
    body: JSON.stringify({
      x: pose.x,
      y: pose.y,
      theta: normalizeTheta(pose.theta),
      ...(pose.z === undefined ? {} : { z: pose.z }),
    }),
    parse: false,
  });
}

/**
 * A gait-controller motion key: `"0"` stand, `"1"` locomotion (RL), `"2"` lie
 * down, `"3"` damping, `"4"` emergency stop, `"5"` MPC. Stand and lie down are
 * sent here too (use-posture.ts), not as posture tasks.
 */
export type MotionKey = "0" | "1" | "2" | "3" | "4" | "5";

export interface SetMotionKeyResult {
  key: MotionKey;
  /**
   * False only for `"4"`, which the backend deliberately does not forward.
   * True means the datagram was written, **not** that the robot moved: it is
   * one-way UDP.
   */
  sent: boolean;
  message: string;
}

const SetMotionKeyResultSchema: z.ZodType<SetMotionKeyResult> = z.object({
  key: z.enum(["0", "1", "2", "3", "4", "5"]),
  sent: z.boolean(),
  message: z.string(),
});

export function setMotionKey(key: MotionKey): Promise<SetMotionKeyResult> {
  return requestJson<SetMotionKeyResult>(
    apiUrl("/api/v1/robot/set_motion_key"),
    {
      method: "POST",
      body: JSON.stringify({ key }),
      schema: SetMotionKeyResultSchema,
    },
  );
}

/**
 * The policy index: 0 PPO, 1 HIMLOCO — the only two the backend accepts.
 * Anything else 422s with an array, not a sentence, so keep the UI a fixed
 * set. Unrelated to the robot's MANUAL / AUTO "mode".
 */
export type PolicyMode = 0 | 1;

export interface SetPolicyModeResult {
  mode: PolicyMode;
  message: string;
}

const SetPolicyModeResultSchema: z.ZodType<SetPolicyModeResult> = z.object({
  mode: z.union([z.literal(0), z.literal(1)]),
  message: z.string(),
});

/**
 * Switch the locomotion policy; meaningful only under RL, which nothing can
 * check (the live controller is not reported). Fire and forget, like the key.
 */
export function setPolicyMode(mode: PolicyMode): Promise<SetPolicyModeResult> {
  return requestJson<SetPolicyModeResult>(
    apiUrl("/api/v1/robot/set_policy_mode"),
    {
      method: "POST",
      body: JSON.stringify({ mode }),
      schema: SetPolicyModeResultSchema,
    },
  );
}

export interface SafetyLockResult {
  /** What was asked for, not a reading. */
  locked: boolean;
  /**
   * True when this request engaged the lock, so the backend started (not
   * finished) cancelling every running job.
   */
  cancel_requested: boolean;
  message: string;
}

const SafetyLockResultSchema: z.ZodType<SafetyLockResult> = z.object({
  locked: z.boolean(),
  cancel_requested: z.boolean(),
  message: z.string(),
});

/**
 * Engage or release the driver's safety lock — the emergency stop (not motion
 * key `"4"`). While engaged the driver drops drive and motion keys, and the
 * backend cancels every job on the rising edge whoever engaged it, so this
 * console sends no cancels of its own.
 *
 * The answer is an echo; the reading is `low_level_mode.safety_locked`. A 502
 * means nothing was locked.
 */
export function setSafetyLock(locked: boolean): Promise<SafetyLockResult> {
  return requestJson<SafetyLockResult>(apiUrl("/api/v1/robot/estop"), {
    method: "POST",
    body: JSON.stringify({ locked }),
    schema: SafetyLockResultSchema,
  });
}

export interface RestartResult {
  /**
   * Usually true (outcome via fetchRestartStatus); false if it already
   * finished inside the ack window.
   */
  restarting: boolean;
  message: string;
}

const RestartResultSchema: z.ZodType<RestartResult> = z.object({
  restarting: z.boolean(),
  message: z.string(),
});

/**
 * Rebuild the live mode's stack — the only way to restart it in place, since
 * a switch to the current mode is a no-op. The backend survives the rebuild,
 * so this answers promptly; the outcome is read from GET /robot/restart.
 *
 * 409 `restart_refused` in Mapping (an unsaved map) or with no / both stacks
 * up, 409 `restart_running` on a second press.
 */
export function restartRobotStack(): Promise<RestartResult> {
  return requestJson<RestartResult>(apiUrl("/api/v1/robot/restart"), {
    method: "POST",
    schema: RestartResultSchema,
  });
}

export type RestartStatus = "idle" | "restarting" | "succeeded" | "failed";

export interface RestartRecord {
  /** `idle` if none since the backend started (it is kept in memory). */
  status: RestartStatus;
  /** The reason, on `failed`. */
  message: string;
  /** ISO 8601, UTC. Null when idle. */
  started_at: string | null;
  /** ISO 8601, UTC. Null until it ended. */
  finished_at: string | null;
}

const RestartRecordSchema: z.ZodType<RestartRecord> = z.object({
  status: z.enum(["idle", "restarting", "succeeded", "failed"]),
  message: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
});

/**
 * The only place a restart's outcome shows: GET /robot/state keeps serving
 * the last frame through the rebuild. `restarting` always ends (the backend
 * fails it after three minutes).
 */
export function fetchRestartStatus(signal?: AbortSignal): Promise<RestartRecord> {
  return requestJson<RestartRecord>(apiUrl("/api/v1/robot/restart"), {
    signal,
    schema: RestartRecordSchema,
  });
}
