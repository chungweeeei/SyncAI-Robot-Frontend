import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { normalizeTheta } from "@/lib/angle";
import { RobotStateSchema } from "@/lib/types/robot";
import type { PlanarPose, RobotState } from "@/lib/types/robot";

/**
 * The console's 1 Hz machine snapshot. 404 until the robot's first frame. Not
 * a source of motion (whole-second stamps, a frozen third-party contract):
 * the 3D viewer reads the telemetry socket.
 */
export function fetchRobotState(signal?: AbortSignal): Promise<RobotState> {
  return requestJson<RobotState>(apiUrl("/api/v1/robot/state"), {
    signal,
    schema: RobotStateSchema,
  });
}

/**
 * Seed localization with an operator pose (RViz's "2D Pose Estimate"). Fire
 * and forget: a 200 means it was sent, not that localization converged — the
 * pose feed moving to the marker is the answer.
 */
export async function setInitialPose(pose: PlanarPose): Promise<void> {
  await requestJson<void>(apiUrl("/api/v1/robot/set_initial_pose"), {
    method: "POST",
    body: JSON.stringify({
      x: pose.x,
      y: pose.y,
      theta: normalizeTheta(pose.theta),
    }),
    parse: false,
  });
}

/**
 * A gait-controller motion key: `"0"` stand, `"1"` locomotion (RL), `"2"` lie
 * down, `"3"` damping, `"4"` emergency stop, `"5"` MPC. Stand and lie down go
 * through the posture task instead; this is for the controller keys.
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
