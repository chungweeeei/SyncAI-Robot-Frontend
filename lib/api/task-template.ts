// Task templates: /api/v1/task_templates — durable rows with full CRUD and no
// dispatch of their own. Not under `/tasks/` because GET /tasks/{id} takes
// any string, which would shadow a static sub-path.
//
// **Waypoint resolution is the server's job.** A stored MOVE keeps a vertex
// reference and a coordinate snapshot, and every read reports
// `resolved_params`, what a dispatch should send *now*. Dispatch projects
// that (`toDispatchSteps`) rather than re-deciding vertex vs snapshot here,
// since only the server holds every map's vertices.

import { z } from "zod";

import { apiUrl } from "@/lib/api/config";
import { requestJson, type ErrorBody } from "@/lib/api/http";
import type { ScheduleTrigger } from "@/lib/api/schedule";
import {
  DemoStepParamsSchema,
  MoveStepParamsSchema,
  SpeakStepParamsSchema,
  WaitStepParamsSchema,
} from "@/lib/api/task";
import type {
  BareStepType,
  DemoStepParams,
  MoveStepParams,
  NavStepType,
  SpeakStepParams,
  TaskStepRequest,
  WaitStepParams,
} from "@/lib/api/task";

/** One step as it is *stored*: a task step plus where a MOVE's numbers came from. */
export type TemplateStepRequest = TaskStepRequest & {
  /** MOVE / DOCK only — the backend 422s any other step carrying one. */
  vertex_id?: string | null;
};

/**
 * Whether a stored MOVE's vertex reference still resolves.
 *
 * `NONE` — typed by hand. `CURRENT` — live values, the step follows the map.
 * `MISSING` — deleted; the snapshot is used and the operator is told.
 */
export type VertexRefStatus = "NONE" | "CURRENT" | "MISSING";

interface TemplateStepBase {
  id: string;
  vertex_id: string | null;
  /** Live name when CURRENT, the snapshot label when MISSING, else null. */
  vertex_name: string | null;
  vertex_status: VertexRefStatus;
  /** Adjacent steps sharing a group run side by side; null on its own (or absent). */
  group: string | null;
}

/**
 * Discriminated on `type`, like `TaskStepRequest`. `params` is the snapshot as
 * saved; `resolved_params` is what to send now — they differ only for a MOVE
 * whose vertex still exists.
 */
export type TemplateStep =
  | (TemplateStepBase & {
      type: NavStepType;
      params: MoveStepParams | null;
      resolved_params: MoveStepParams | null;
    })
  | (TemplateStepBase & {
      type: "SPEAK";
      params: SpeakStepParams | null;
      resolved_params: SpeakStepParams | null;
    })
  | (TemplateStepBase & {
      type: "WAIT";
      params: WaitStepParams | null;
      resolved_params: WaitStepParams | null;
    })
  | (TemplateStepBase & {
      type: "DEMO";
      params: DemoStepParams | null;
      resolved_params: DemoStepParams | null;
    })
  | (TemplateStepBase & {
      type: BareStepType;
      params: null;
      resolved_params: null;
    });

export interface TaskTemplate {
  /** A uuid, **not** a task id: `fetchTaskState` cannot take it. */
  id: string;
  name: string;
  description: string;
  /** Null when the template has no MOVE / DOCK step and so runs anywhere. */
  map_name: string | null;
  steps: TemplateStep[];
  /** False only when it names a map other than the robot's. */
  map_matches_active: boolean;
  missing_vertex_count: number;
  created_at: string;
  updated_at: string;
}

export interface TaskTemplateDraft {
  name: string;
  description?: string;
  /** Required when any step is a MOVE or DOCK; must be omitted otherwise. */
  map_name?: string | null;
  steps: readonly TemplateStepRequest[];
}

/** Omitted fields are left alone (`exclude_unset`). */
export type TaskTemplateChanges = Partial<TaskTemplateDraft>;

/** A plain union, as for TaskStepRequestSchema: a bare step's discriminator is three literals. */
const TemplateStepSchema: z.ZodType<TemplateStep> = z.union([
  z.object({
    id: z.string(),
    vertex_id: z.string().nullable(),
    vertex_name: z.string().nullable(),
    vertex_status: z.enum(["NONE", "CURRENT", "MISSING"]),
    group: z.string().nullish().transform((group) => group ?? null),
    type: z.enum(["MOVE", "DOCK"]),
    params: MoveStepParamsSchema.nullable(),
    resolved_params: MoveStepParamsSchema.nullable(),
  }),
  z.object({
    id: z.string(),
    vertex_id: z.string().nullable(),
    vertex_name: z.string().nullable(),
    vertex_status: z.enum(["NONE", "CURRENT", "MISSING"]),
    group: z.string().nullish().transform((group) => group ?? null),
    type: z.literal("SPEAK"),
    params: SpeakStepParamsSchema.nullable(),
    resolved_params: SpeakStepParamsSchema.nullable(),
  }),
  z.object({
    id: z.string(),
    vertex_id: z.string().nullable(),
    vertex_name: z.string().nullable(),
    vertex_status: z.enum(["NONE", "CURRENT", "MISSING"]),
    group: z.string().nullish().transform((group) => group ?? null),
    type: z.literal("WAIT"),
    params: WaitStepParamsSchema.nullable(),
    resolved_params: WaitStepParamsSchema.nullable(),
  }),
  z.object({
    id: z.string(),
    vertex_id: z.string().nullable(),
    vertex_name: z.string().nullable(),
    vertex_status: z.enum(["NONE", "CURRENT", "MISSING"]),
    group: z.string().nullish().transform((group) => group ?? null),
    type: z.literal("DEMO"),
    params: DemoStepParamsSchema.nullable(),
    resolved_params: DemoStepParamsSchema.nullable(),
  }),
  z.object({
    id: z.string(),
    vertex_id: z.string().nullable(),
    vertex_name: z.string().nullable(),
    vertex_status: z.enum(["NONE", "CURRENT", "MISSING"]),
    group: z.string().nullish().transform((group) => group ?? null),
    type: z.enum(["STANDUP", "LIEDOWN"]),
    params: z.null(),
    resolved_params: z.null(),
  }),
]);

const TaskTemplateSchema: z.ZodType<TaskTemplate> = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  map_name: z.string().nullable(),
  steps: z.array(TemplateStepSchema),
  map_matches_active: z.boolean(),
  missing_vertex_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

function taskTemplatePath(id?: string): string {
  const base = "/api/v1/task_templates";
  return apiUrl(id ? `${base}/${encodeURIComponent(id)}` : base);
}

export function listTaskTemplates(signal?: AbortSignal): Promise<TaskTemplate[]> {
  // Unfiltered on purpose: the console scopes to the active map itself so it
  // can say how many it hid, rather than seem to have lost them.
  return requestJson<TaskTemplate[]>(taskTemplatePath(), {
    signal,
    schema: z.array(TaskTemplateSchema),
  });
}

/** A save refused over one step, with its wire id (`3-move`) for the editor to mark. */
export class StepRefusalError extends Error {
  constructor(
    message: string,
    readonly stepId: string,
  ) {
    super(message);
    this.name = "StepRefusalError";
  }
}

function stepRefusal({ detail, stepId }: ErrorBody): Error | undefined {
  return stepId ? new StepRefusalError(detail, stepId) : undefined;
}

export function createTaskTemplate(draft: TaskTemplateDraft): Promise<TaskTemplate> {
  return requestJson<TaskTemplate>(taskTemplatePath(), {
    method: "POST",
    body: JSON.stringify(draft),
    schema: TaskTemplateSchema,
    mapError: stepRefusal,
  });
}

export function updateTaskTemplate(
  id: string,
  changes: TaskTemplateChanges,
): Promise<TaskTemplate> {
  return requestJson<TaskTemplate>(taskTemplatePath(id), {
    method: "PUT",
    body: JSON.stringify(changes),
    schema: TaskTemplateSchema,
    mapError: stepRefusal,
  });
}

export function deleteTaskTemplate(id: string): Promise<void> {
  return requestJson<void>(taskTemplatePath(id), {
    method: "DELETE",
    parse: false,
  });
}

/**
 * Freeze a template's current resolution into a schedule. Stricter than a
 * dispatch: an unattended run gets no snapshot fallback, so a map that is not
 * active or a MISSING waypoint is refused (400).
 */
export function scheduleTaskTemplate(
  id: string,
  scheduleId: string,
  trigger: ScheduleTrigger,
): Promise<void> {
  return requestJson<void>(apiUrl(`/api/v1/task_templates/${encodeURIComponent(id)}/schedule`), {
    method: "POST",
    body: JSON.stringify({ id: scheduleId, trigger }),
    parse: false,
  });
}
