"use client";

import { Chip } from "@/components/console/instrument";
import type { TaskTemplate } from "@/lib/api/task-template";

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
  // Information, not a fault: registered before a task's delete took its
  // schedules with it, it still runs the steps it was registered with.
  if (!templates.some((template) => template.id === schedule.task_template_id)) {
    return <Chip tone="neutral">task deleted</Chip>;
  }
  return null;
}
