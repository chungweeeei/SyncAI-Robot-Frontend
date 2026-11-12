// Tasks: /api/v1/tasks. Creation is dispatch — a 200 means the robot is about
// to act; there is no separate run call.
//
// `fetchActiveTasks` lists the **running** runs (how a caller recovers an id
// it never had: after a reload, or a schedule's); `fetchTaskHistory` the
// **finished** ones. Both read the orchestrator's index, so history only
// reaches back as far as its retention (a day on a fresh install).

import * as z from "zod";

import { normalizeTheta } from "@/lib/angle";
import { apiUrl } from "@/lib/api/config";
import { requestJson, requestRaw } from "@/lib/api/http";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * PAUSED is a *reading* (`GET /tasks/{id}`, once a step is held). PAUSING is
 * only the unparsed pause ack's claim; listed so a backend that ever reports
 * it from the read does not fail the schema. SKIPPED is a step's only: a job
 * continuing a failed one (`continueTask`) passes over the steps that one got
 * past, and lists them so its steps are the failed job's.
 */
const TaskStatusSchema = z.enum([
  "PENDING",
  "IN_PROGRESS",
  "PAUSED",
  "PAUSING",
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "SKIPPED",
]);

export type TaskStatus =
  | "PENDING"
  | "IN_PROGRESS"
  | "PAUSED"
  | "PAUSING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELED"
  | "SKIPPED";

/** A hold is not an end: a paused run is still running to the orchestrator. */
export const TERMINAL_TASK_STATUSES: readonly TaskStatus[] = [
  "COMPLETED",
  "FAILED",
  "CANCELED",
];

export function isTerminalTaskStatus(status: TaskStatus | undefined | null): boolean {
  return status != null && TERMINAL_TASK_STATUSES.includes(status);
}

/** A pose to drive to, with the ground height of its floor when it is not the ground floor. */
export type GoalPose = PlanarPose & { z?: number };

export interface TaskStepState {
  id: string;
  status: TaskStatus;
  error_msg: string;
  /**
   * A running MOVE's navigator sentence ("Path blocked; replanning"), or a
   * running PATROL's progress the backend words from the robot's feedback
   * ("Patrolling: 3 of 5 waypoints left, 12.4 m to go"), else "". Display
   * only. Optional for older backends.
   */
  message?: string;
  /** Steps sharing a group ran side by side; null on its own (or absent). */
  group?: string | null;
  /** ISO 8601 UTC; null until the step starts. Absent from older backends. */
  started_at?: string | null;
  /** ISO 8601 UTC; null until the step ends, however it ends. */
  ended_at?: string | null;
  /**
   * Seconds the job was held while this step was under way; the step's own
   * time is `ended_at − started_at − paused_seconds`.
   */
  paused_seconds?: number;
  /** A PATROL's waypoints the robot has passed; 0 for every other step. */
  waypoints_passed?: number;
}

export interface TaskStateResponse {
  id: string;
  status: TaskStatus;
  steps: TaskStepState[];
}

const TaskStateResponseSchema: z.ZodType<TaskStateResponse> = z.object({
  id: z.string(),
  status: TaskStatusSchema,
  steps: z.array(
    z.object({
      id: z.string(),
      status: TaskStatusSchema,
      error_msg: z.string(),
      message: z.string().optional(),
      group: z.string().nullish(),
      started_at: z.string().nullish(),
      ended_at: z.string().nullish(),
      paused_seconds: z.number().optional(),
      waypoints_passed: z.number().optional(),
    }),
  ),
});

interface TaskAckResponse {
  id: string;
  status: TaskStatus;
  message: string;
}

/** Checked: a renamed `id` would be an endless 1 Hz poll of `/tasks/undefined`. */
const TaskAckResponseSchema: z.ZodType<TaskAckResponse> = z.object({
  id: z.string(),
  status: TaskStatusSchema,
  message: z.string(),
});

interface TaskContinuationAck extends TaskAckResponse {
  continued_from: string;
  from_step_id: string;
}

/** Checked like the plain ack: its `id` is a poll target as much. */
const TaskContinuationAckSchema: z.ZodType<TaskContinuationAck> = z.object({
  id: z.string(),
  status: TaskStatusSchema,
  message: z.string(),
  continued_from: z.string(),
  from_step_id: z.string(),
});

/** Posture steps carry no params; sending any is refused. */
export type Posture = "STANDUP" | "LIEDOWN";

/**
 * The steps set by one pose in the map frame, which is what ties a job to its
 * map: a Move. Kept as a name so the next one-pose step is one more member
 * rather than a sweep.
 */
export type NavStepType = "MOVE";

/**
 * Every step set by poses in the map frame: a Move (one pose) and a
 * Patrol (an ordered list of them). Each is a stop in the editor, ties a job
 * to its map and occupies the robot's body.
 */
export type StopStepType = NavStepType | "PATROL";

/** The steps that carry no params; sending any is refused. */
export type BareStepType = Posture;

/** The backend's full `StepType` vocabulary. */
export type StepType = StopStepType | "SPEAK" | "WAIT" | BareStepType;

/** `theta` in degrees, folded into (-180, 180] on the way out. */
export interface MoveStepParams {
  x: number;
  y: number;
  theta: number;
  /**
   * Ground height of the goal's floor, metres. The robot's planner aims the
   * goal at the walkable surface nearest it; absent is the ground floor.
   */
  z?: number;
}

/**
 * One pose a Patrol drives through, `theta` in degrees folded into
 * (-180, 180]. Unlike a Move's, `z` is always sent: the contract defaults it
 * to 0 but a patrol is new, so there is no older request shape to keep.
 */
export interface PatrolWaypoint {
  x: number;
  y: number;
  theta: number;
  /** Ground height of the waypoint's floor, metres. */
  z: number;
}

/**
 * The robot drives through the waypoints in order without stopping or
 * turning at any but the last, which it reaches as a Move: only the last
 * `theta` is honoured, the others are sent and ignored. At least two
 * (`PATROL_WAYPOINTS_MIN` in lib/task/step.ts); a single pose is a Move.
 */
export interface PatrolStepParams {
  waypoints: PatrolWaypoint[];
}

/**
 * `voice` and `speed` are backend-defaulted and never authored here, but typed
 * so a template saved with them round-trips.
 */
export interface SpeakStepParams {
  /** English only for now; see `SPEAK_TEXT_MAX` in lib/task/step.ts. */
  text: string;
  voice?: string;
  speed?: number;
  /** Times to say it; see `SPEAK_REPEAT_MAX`. Sent only above the default of once. */
  repeat?: number;
}

/** Seconds; range in `WAIT_SECONDS_MAX` (lib/task/step.ts). */
export interface WaitStepParams {
  seconds: number;
}

/**
 * One step as the endpoint takes it. Discriminated so a bare step cannot
 * carry `params`, which 422s with a validation array instead of a sentence.
 */
export type TaskStepRequest = (
  | { id: string; type: NavStepType; params: MoveStepParams }
  | { id: string; type: "PATROL"; params: PatrolStepParams }
  | { id: string; type: "SPEAK"; params: SpeakStepParams }
  | { id: string; type: "WAIT"; params: WaitStepParams }
  | { id: string; type: BareStepType }
) & {
  /**
   * Adjacent steps in one group start together; the next waits for all.
   * Never sent for a lone step (a schedule read back answers null).
   */
  group?: string | null;
};

export const MoveStepParamsSchema: z.ZodType<MoveStepParams> = z.object({
  x: z.number(),
  y: z.number(),
  theta: z.number(),
  z: z.number().optional(),
});

export const PatrolStepParamsSchema: z.ZodType<PatrolStepParams> = z.object({
  waypoints: z.array(
    z.object({
      x: z.number(),
      y: z.number(),
      theta: z.number(),
      // Defaulted as the contract defaults it, so a read without it is the ground floor.
      z: z.number().default(0),
    }),
  ),
});

export const SpeakStepParamsSchema: z.ZodType<SpeakStepParams> = z.object({
  text: z.string(),
  voice: z.string().optional(),
  speed: z.number().optional(),
  repeat: z.number().optional(),
});

export const WaitStepParamsSchema: z.ZodType<WaitStepParams> = z.object({
  seconds: z.number(),
});

/** The fields every step request carries, spread into each branch below. */
const stepRequestBase = {
  id: z.string(),
  group: z.string().nullish(),
};

/**
 * For a schedule's step list read back. A plain union: a bare step's
 * discriminator is three literals.
 */
export const TaskStepRequestSchema: z.ZodType<TaskStepRequest> = z.union([
  z.object({
    ...stepRequestBase,
    type: z.literal("MOVE"),
    params: MoveStepParamsSchema,
  }),
  z.object({
    ...stepRequestBase,
    type: z.literal("PATROL"),
    params: PatrolStepParamsSchema,
  }),
  z.object({
    ...stepRequestBase,
    type: z.literal("SPEAK"),
    params: SpeakStepParamsSchema,
  }),
  z.object({
    ...stepRequestBase,
    type: z.literal("WAIT"),
    params: WaitStepParamsSchema,
  }),
  z.object({
    ...stepRequestBase,
    type: z.enum(["STANDUP", "LIEDOWN"]),
  }),
]);

/**
 * Per-page-load sequence appended to every task id. A duplicate id is not a
 * 409 but a 502 that reads as the orchestrator being down, and two presses in
 * one second would collide on the timestamp alone. Not random, so the id
 * stays greppable (`robot01-task-1782786519-3`).
 */
let submitSeq = 0;

/**
 * How this console starts a job: the id's second segment, and recorded on the
 * run for history. "schedule" is stamped by the backend only, so it is not here.
 */
export type TaskKind = "goal" | "standup" | "liedown" | "task";

/** The history filter's vocabulary: every kind a finished run can carry. */
export type TaskHistoryKind = TaskKind | "schedule";

/** `name` is the template a dispatch came from, which the id cannot say. */
interface TaskRequest {
  id: string;
  timestamp: number;
  kind: TaskKind;
  name: string | null;
  /**
   * The map the coordinates were planned on; a check, refused when it is not
   * the robot's map. Omitted for a job that does not move.
   */
  map_name?: string;
  steps: readonly TaskStepRequest[];
}

/** `timestamp` is required and unread, so it reuses the id's value. */
function newTaskIdentity(
  robotId: string,
  kind: TaskKind,
): { id: string; timestamp: number } {
  const timestamp = Math.floor(Date.now() / 1000);
  submitSeq += 1;
  return { id: `${robotId}-${kind}-${timestamp}-${submitSeq}`, timestamp };
}

async function postTask(
  robotId: string,
  kind: TaskKind,
  steps: readonly TaskStepRequest[],
  name: string | null = null,
  mapName: string | null = null,
): Promise<string> {
  const { id, timestamp } = newTaskIdentity(robotId, kind);
  const body: TaskRequest = { id, timestamp, kind, name, steps };
  if (mapName !== null) body.map_name = mapName;
  const ack = await requestJson<TaskAckResponse>(apiUrl("/api/v1/tasks"), {
    method: "POST",
    body: JSON.stringify(body),
    schema: TaskAckResponseSchema,
  });
  return ack.id;
}

/**
 * A MOVE's params. `z` is sent only off the ground floor, so a ground-floor
 * goal is the same request a backend from before floors took.
 */
export function moveParams(x: number, y: number, theta: number, z = 0): MoveStepParams {
  const params = { x, y, theta: normalizeTheta(theta) };
  return z ? { ...params, z } : params;
}

/** A Patrol waypoint's wire shape: the heading folded, `z` always present. */
export function patrolWaypoint(x: number, y: number, theta: number, z = 0): PatrolWaypoint {
  return { x, y, theta: normalizeTheta(theta), z };
}

/**
 * A one-step MOVE for a dragged goal. `mapName` is the map it was aimed on, so
 * a switch from another console in between is refused, not driven.
 */
export function sendMoveTask(
  robotId: string,
  goal: GoalPose,
  mapName: string | null = null,
): Promise<string> {
  return postTask(
    robotId,
    "goal",
    [
      {
        id: "goal",
        type: "MOVE",
        params: moveParams(goal.x, goal.y, goal.theta, goal.z),
      },
    ],
    null,
    mapName,
  );
}

/**
 * The route the robot would drive from where it stands to a goal: what
 * `POST /api/v1/route_preview` answers. A goal the planner cannot reach is
 * an answer too (`reachable: false`, with why), not a refusal.
 */
export interface RoutePreview {
  reachable: boolean;
  /** Map-frame [x, y, z], z the ground under each; empty when not reachable. */
  points: [number, number, number][];
  /** Along the route in 3D, so a stair's rise counts. 0 when not reachable. */
  length_m: number;
  /** Why there is no route (`goal_in_keepout`, `no_valid_path`, …); null when reachable. */
  code: string | null;
  /**
   * The sentence the MOVE would have failed with ("Planning failed: …"), so
   * `stepFailureText` says it in the house words; "" when reachable.
   */
  message: string;
}

const RoutePreviewSchema: z.ZodType<RoutePreview> = z.object({
  reachable: z.boolean(),
  points: z.array(z.tuple([z.number(), z.number(), z.number()])),
  length_m: z.number(),
  code: z.string().nullable(),
  message: z.string(),
});

/**
 * Ask the planner for a goal's route without sending the robot. Nothing is
 * dispatched, recorded or cached: it changes no resource, so no key is
 * invalidated by it. `mapName` is checked as a dispatch's is (409
 * `map_mismatch`).
 */
export function previewRoute(
  goal: GoalPose,
  mapName: string | null = null,
  signal?: AbortSignal,
): Promise<RoutePreview> {
  const body: MoveStepParams & { map_name?: string } = moveParams(
    goal.x,
    goal.y,
    goal.theta,
    goal.z,
  );
  if (mapName !== null) body.map_name = mapName;
  return requestJson<RoutePreview>(apiUrl("/api/v1/route_preview"), {
    method: "POST",
    body: JSON.stringify(body),
    schema: RoutePreviewSchema,
    signal,
  });
}

/**
 * Dispatch an authored step list (already wire shape; see lib/task/step.ts)
 * and return its id. `name` is the source template, recorded for history;
 * `mapName` is the template's `map_name`.
 */
export function submitTask(
  robotId: string,
  steps: readonly TaskStepRequest[],
  name: string | null = null,
  mapName: string | null = null,
): Promise<string> {
  return postTask(robotId, "task", steps, name, mapName);
}

/**
 * Run a FAILED job again from the step it failed at, as a new job: the backend
 * reads the steps off the failed one, starts at that step's group (a Patrol
 * past the waypoints it had passed), and lists the steps before it as
 * SKIPPED. No map is sent: the positions are the failed job's, so its map is
 * the check. `kind` is the failed job's (lib/task/history.ts's
 * `continuationKind`).
 */
export async function continueTask(
  robotId: string,
  failedId: string,
  kind: TaskKind,
): Promise<string> {
  const { id, timestamp } = newTaskIdentity(robotId, kind);
  const ack = await requestJson<TaskContinuationAck>(apiUrl("/api/v1/tasks"), {
    method: "POST",
    body: JSON.stringify({ id, timestamp, kind, continue_from: failedId }),
    schema: TaskContinuationAckSchema,
  });
  return ack.id;
}

export function fetchTaskState(
  id: string,
  signal?: AbortSignal,
): Promise<TaskStateResponse> {
  return requestJson<TaskStateResponse>(
    apiUrl(`/api/v1/tasks/${encodeURIComponent(id)}`),
    { signal, schema: TaskStateResponseSchema },
  );
}

export type TaskSource = "DIRECT" | "SCHEDULE";

export interface ActiveTask {
  /** The id `fetchTaskState` and `cancelTask` take. */
  id: string;
  run_id: string;
  status: TaskStatus;
  /** ISO 8601, UTC. */
  started_at: string;
  /** ISO 8601, UTC; null while running, set in `recently_ended`. */
  ended_at: string | null;
  source: TaskSource;
  /** Set only when `source` is "SCHEDULE". */
  schedule_id: string | null;
  /**
   * See `TaskHistoryKind`. A string, not the union: an unknown kind must be an
   * unfamiliar label, not a parse failure that drops the list and the map lock.
   */
  kind: string | null;
  /** The source template, if any. */
  name: string | null;
  /** Null for a job that uses no map. Locks the map (lib/map/run-lock.ts). */
  map_name: string | null;
}

/** Absent reads as null, so an older backend still parses (it still enforces the lock). */
const AbsentOrNullStringSchema = z.string().nullable().default(null);

const ActiveTaskSchema: z.ZodType<ActiveTask> = z.object({
  id: z.string(),
  run_id: z.string(),
  status: TaskStatusSchema,
  started_at: z.string(),
  ended_at: AbsentOrNullStringSchema,
  source: z.enum(["DIRECT", "SCHEDULE"]),
  schedule_id: z.string().nullable(),
  kind: AbsentOrNullStringSchema,
  name: AbsentOrNullStringSchema,
  map_name: AbsentOrNullStringSchema,
});

const ActiveTasksResponseSchema: z.ZodType<ActiveTasksResponse> = z.object({
  tasks: z.array(ActiveTaskSchema),
  // Absent from a backend older than it: nothing just ended, as before.
  recently_ended: z.array(ActiveTaskSchema).default([]),
  as_of: z.string(),
});

export interface ActiveTasksResponse {
  tasks: ActiveTask[];
  /**
   * Runs that closed in the last few seconds, newest first. Never running:
   * no map lock and no "busy" reads them. A run that starts and fails between
   * two polls is in here and never in `tasks`.
   */
  recently_ended: ActiveTask[];
  /**
   * When the backend read it, ISO 8601 UTC. Measure elapsed time against this,
   * not the browser clock: different clocks, and the answer is cached.
   */
  as_of: string;
}

/** Everything running now, including runs this tab never started. */
export function fetchActiveTasks(
  signal?: AbortSignal,
): Promise<ActiveTasksResponse> {
  return requestJson<ActiveTasksResponse>(apiUrl("/api/v1/active_tasks"), {
    signal,
    schema: ActiveTasksResponseSchema,
  });
}

/**
 * The ack is dropped: its "CANCELED" is a claim about the request; the next
 * `fetchTaskState` says whether the robot stopped.
 */
export function cancelTask(id: string): Promise<void> {
  return requestJson<void>(apiUrl(`/api/v1/tasks/${encodeURIComponent(id)}`), {
    method: "DELETE",
    parse: false,
  });
}

/**
 * Hold or release a running task. The ack's PAUSING / IN_PROGRESS is a claim
 * about the request, so it is dropped like `cancelTask`'s: PAUSED is read from
 * `fetchTaskState`. A pause lands at once on a MOVE, PATROL or WAIT, but only after a
 * SPEAK or posture finishes.
 */
export function pauseTask(id: string): Promise<void> {
  return requestJson<void>(
    apiUrl(`/api/v1/tasks/${encodeURIComponent(id)}/pause`),
    { method: "POST", parse: false },
  );
}

export function resumeTask(id: string): Promise<void> {
  return requestJson<void>(
    apiUrl(`/api/v1/tasks/${encodeURIComponent(id)}/resume`),
    { method: "POST", parse: false },
  );
}

export type TaskHistoryStatus = "COMPLETED" | "FAILED" | "CANCELED";

/**
 * An `ActiveTask` plus its close time. The backend folds timed-out into FAILED
 * and terminated into CANCELED.
 */
export interface TaskHistoryEntry {
  id: string;
  run_id: string;
  status: TaskHistoryStatus;
  /** ISO 8601, UTC. */
  started_at: string;
  /** ISO 8601, UTC. */
  closed_at: string | null;
  source: TaskSource;
  /** Set only when `source` is "SCHEDULE". */
  schedule_id: string | null;
  /** As for `ActiveTask.kind`: an unknown kind must not blank the page. */
  kind: string | null;
  name: string | null;
  map_name: string | null;
}

export interface TaskHistoryResponse {
  /** Newest close first; the backend offers no other order. */
  tasks: TaskHistoryEntry[];
  /** Null on the last page. Valid only under its filter; see queryKeys.taskHistoryPage. */
  next_page_token: string | null;
}

const TaskHistoryResponseSchema: z.ZodType<TaskHistoryResponse> = z.object({
  tasks: z.array(
    z.object({
      id: z.string(),
      run_id: z.string(),
      status: z.enum(["COMPLETED", "FAILED", "CANCELED"]),
      started_at: z.string(),
      closed_at: z.string().nullable(),
      source: z.enum(["DIRECT", "SCHEDULE"]),
      schedule_id: z.string().nullable(),
      kind: z.string().nullable(),
      name: z.string().nullable(),
      map_name: AbsentOrNullStringSchema,
    }),
  ),
  next_page_token: z.string().nullable(),
});

/** Shared by the page and stats reads, so both describe the same runs. */
export interface TaskHistoryFilterQuery {
  status?: TaskHistoryStatus;
  /** ISO 8601 UTC bounds on the close time. */
  since?: string;
  until?: string;
  kind?: TaskHistoryKind;
  /** Exact template name. */
  name?: string;
}

export interface TaskHistoryQuery extends TaskHistoryFilterQuery {
  pageToken?: string;
  pageSize?: number;
}

function historyFilterParams({
  status,
  since,
  until,
  kind,
  name,
}: TaskHistoryFilterQuery): URLSearchParams {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (since) params.set("since", since);
  if (until) params.set("until", until);
  if (kind) params.set("kind", kind);
  if (name) params.set("name", name);
  return params;
}

/**
 * One page of finished runs, newest close first. Cursor paging only — there
 * is no count, so no "page 3 of 7".
 */
export function fetchTaskHistory(
  { pageToken, pageSize, ...filter }: TaskHistoryQuery,
  signal?: AbortSignal,
): Promise<TaskHistoryResponse> {
  const params = historyFilterParams(filter);
  if (pageSize !== undefined) params.set("page_size", String(pageSize));
  if (pageToken) params.set("page_token", pageToken);
  const query = params.toString();
  return requestJson<TaskHistoryResponse>(
    apiUrl(`/api/v1/task_history${query ? `?${query}` : ""}`),
    { signal, schema: TaskHistoryResponseSchema },
  );
}

/** Exact counts of the finished runs matching a filter. */
export interface TaskHistoryStats {
  /** ISO 8601 UTC. */
  as_of: string;
  total: number;
  by_status: Record<TaskHistoryStatus, number>;
  /** Completed over total, or null when nothing finished — never a 0 that claims failure. */
  success_rate: number | null;
}

const TaskHistoryStatsSchema: z.ZodType<TaskHistoryStats> = z.object({
  as_of: z.string(),
  total: z.number(),
  by_status: z.object({
    COMPLETED: z.number(),
    FAILED: z.number(),
    CANCELED: z.number(),
  }),
  success_rate: z.number().nullable(),
});

export function fetchTaskHistoryStats(
  filter: TaskHistoryFilterQuery,
  signal?: AbortSignal,
): Promise<TaskHistoryStats> {
  const query = historyFilterParams(filter).toString();
  return requestJson<TaskHistoryStats>(
    apiUrl(`/api/v1/task_history/stats${query ? `?${query}` : ""}`),
    { signal, schema: TaskHistoryStatsSchema },
  );
}

/**
 * The report: every finished run matching `filter` as CSV, one row per step,
 * with times written in `timeZone` (UTC when ""). Read from the robot's own
 * record, which keeps 30 days — not the orchestrator's index the list reads —
 * so it holds only jobs that ended since the robot started keeping it.
 */
export async function exportTaskHistory(
  filter: TaskHistoryFilterQuery,
  timeZone: string,
): Promise<Blob> {
  const params = historyFilterParams(filter);
  if (timeZone) params.set("tz", timeZone);
  const query = params.toString();
  const res = await requestRaw(
    apiUrl(`/api/v1/task_history/export${query ? `?${query}` : ""}`),
  );
  return res.blob();
}
