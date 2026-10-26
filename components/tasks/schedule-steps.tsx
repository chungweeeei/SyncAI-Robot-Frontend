"use client";

import { Chip } from "@/components/console/instrument";
import { useSchedule } from "@/hooks/use-schedules";
import type { TaskTemplate } from "@/lib/api/task-template";
import { scheduleDrift } from "@/lib/task/schedule";

/**
 * Whether a schedule still runs what its task says, read when the task's
 * card is opened: the list endpoint cannot carry steps (a Temporal list
 * element has no args), so each needs its own `describe` — one RPC per
 * schedule on demand instead of N per paint.
 *
 * A schedule keeps the steps it was registered with and never re-reads them,
 * so a task edited or a waypoint moved since does not reach a scheduled run.
 * Silent while they still match, or when they cannot be compared: the card
 * above already shows what the task does.
 */
export function ScheduleDrift({
  scheduleId,
  source,
}: {
  scheduleId: string;
  source: TaskTemplate;
}) {
  const { schedule } = useSchedule(scheduleId);
  const steps = schedule?.steps;
  if (!steps?.length) return null;

  const drift = scheduleDrift(steps, source.steps);
  if (!drift) return null;
  return (
    <p className="text-[11px] leading-tight text-signal-caution">
      {`${drift} ${drift === 1 ? "step no longer matches" : "steps no longer match"} ` +
        `“${source.name}”. This schedule still runs the task as it was when it was ` +
        "created — delete it and schedule the task again to pick up the changes."}
    </p>
  );
}

/** Why a schedule is in the list of ones no saved task owns. */
export function ScheduleSourceChip({
  schedule,
  templates,
}: {
  schedule: { task_template_id?: string | null };
  templates: readonly TaskTemplate[];
}) {
  // Registered from loose steps, or before the memo carried a source.
  if (!schedule.task_template_id) {
    return <Chip tone="caution">unsaved steps</Chip>;
  }
  // Information, not a fault: the schedule holds its own copy of the steps.
  if (!templates.some((template) => template.id === schedule.task_template_id)) {
    return <Chip tone="neutral">task deleted</Chip>;
  }
  return null;
}
