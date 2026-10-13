// Schedules: /api/v1/schedules. A durable registration (listed, paused,
// deleted, never polled), unlike a task, which is dispatched and gone.
//
// snake_case, `interval_seconds` especially: these backend models have no
// alias generator, so `intervalSeconds` is silently ignored and the request
// 422s naming a field the client never sent.

import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson } from "@/lib/api/http";
import { TaskStepRequestSchema } from "@/lib/api/task";
import type { TaskStepRequest } from "@/lib/api/task";

/**
 * Exactly one of `cron` / `interval_seconds`, or the backend refuses.
 *
 * `| null` because the response serialises the unused fields as explicit
 * nulls (`{"cron": null, "interval_seconds": 86400, ...}`): test truthiness,
 * not `=== undefined`.
 */
export interface ScheduleTrigger {
  cron?: string | null;
  /** > 0. */
  interval_seconds?: number | null;
  /** IANA zone; `cron` only, so omitted for an interval. */
  timezone?: string | null;
}

export interface ScheduleState {
  id: string;
  /** As registered or last edited. */
  trigger: ScheduleTrigger;
  paused: boolean;
  /** ISO-8601 **UTC**, soonest first. Empty while paused. */
  next_run_times: string[];
  /** The map the frozen coordinates are in. Null for older schedules. */
  map_name?: string | null;
  /** The template this was frozen from, if any. */
  task_template_id?: string | null;
  task_template_name?: string | null;
  /**
   * **Only** from `getSchedule` (`[]` from the list, and for an old or
   * undecodable one). Frozen at registration, so later waypoint edits do not
   * reach it; comparing against the template's current resolution shows that.
   */
  steps?: TaskStepRequest[];
}

const ScheduleTriggerSchema: z.ZodType<ScheduleTrigger> = z.object({
  cron: z.string().nullable().optional(),
  interval_seconds: z.number().nullable().optional(),
  timezone: z.string().nullable().optional(),
});

const ScheduleStateSchema: z.ZodType<ScheduleState> = z.object({
  id: z.string(),
  trigger: ScheduleTriggerSchema,
  paused: z.boolean(),
  next_run_times: z.array(z.string()),
  map_name: z.string().nullable().optional(),
  task_template_id: z.string().nullable().optional(),
  task_template_name: z.string().nullable().optional(),
  steps: z.array(TaskStepRequestSchema).optional(),
});

/** The operator types the id, so an unescaped `/` or `#` would change the route. */
function schedulePath(id?: string, action?: "pause" | "resume"): string {
  const base = "/api/v1/schedules";
  if (!id) return apiUrl(base);
  const one = `${base}/${encodeURIComponent(id)}`;
  return apiUrl(action ? `${one}/${action}` : one);
}

/**
 * Every schedule, never their steps: those cost a describe RPC per row, so
 * `getSchedule` carries them.
 */
export function listSchedules(signal?: AbortSignal): Promise<ScheduleState[]> {
  return requestJson<ScheduleState[]>(schedulePath(), {
    signal,
    schema: z.array(ScheduleStateSchema),
  });
}

/** One schedule **with its frozen steps**, read when its row is expanded. */
export function getSchedule(
  id: string,
  signal?: AbortSignal,
): Promise<ScheduleState> {
  return requestJson<ScheduleState>(schedulePath(id), {
    signal,
    schema: ScheduleStateSchema,
  });
}

// The writes drop the `{id, message}` envelope. The recomputed
// `next_run_times` is only knowable by asking, so each is followed by a list
// refresh rather than a local splice.

export function pauseSchedule(id: string): Promise<void> {
  return requestJson<void>(schedulePath(id, "pause"), {
    method: "POST",
    parse: false,
  });
}

export function resumeSchedule(id: string): Promise<void> {
  return requestJson<void>(schedulePath(id, "resume"), {
    method: "POST",
    parse: false,
  });
}

export function deleteSchedule(id: string): Promise<void> {
  return requestJson<void>(schedulePath(id), {
    method: "DELETE",
    parse: false,
  });
}

/**
 * Replace the trigger whole, in place. Not a delete and create, so the id,
 * steps and paused state survive; the id itself cannot change.
 */
export function updateScheduleTrigger(
  id: string,
  trigger: ScheduleTrigger,
): Promise<void> {
  return requestJson<void>(schedulePath(id), {
    method: "PATCH",
    body: JSON.stringify({ trigger }),
    parse: false,
  });
}
