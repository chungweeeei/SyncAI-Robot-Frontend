"use client";

import * as React from "react";

import { Chip } from "@/components/console/instrument";
import { useSchedule } from "@/hooks/use-schedules";
import type { TaskTemplate } from "@/lib/api/task-template";
import { GroupRail } from "@/components/tasks/group-rail";
import type { TaskStepRequest } from "@/lib/api/task";
import { scheduleDrift } from "@/lib/task/schedule";
import { repeatSuffix, stepGlyph, wireGroupPlaces } from "@/lib/task/step";
import { cn } from "@/lib/utils";

export interface ScheduleStepsProps {
  scheduleId: string;
  /** The template this schedule was frozen from, if it is still in the library. */
  source: TaskTemplate | null;
}

/**
 * A registered schedule's frozen step list, fetched when the row is expanded:
 * the list endpoint cannot carry steps (a Temporal list element has no args),
 * so each needs its own `describe` — one RPC on demand instead of N per paint.
 *
 * With its template still in the library, the frozen steps are diffed against
 * its current resolution: frozen steps are never re-read, so a vertex moved
 * since registration never reaches a scheduled run.
 */
export function ScheduleSteps({ scheduleId, source }: ScheduleStepsProps) {
  const { schedule, status } = useSchedule(scheduleId);
  const steps: TaskStepRequest[] | null = schedule ? (schedule.steps ?? []) : null;

  if (status === "loading") {
    return <Line>Reading the frozen steps…</Line>;
  }
  if (status === "error") {
    return <Line>The frozen steps could not be read.</Line>;
  }
  if (!steps?.length) {
    // Not an error: older or externally created schedules report no steps.
    return <Line>This schedule does not report its steps.</Line>;
  }

  const drift = source ? scheduleDrift(steps, source.steps) : null;
  const groupPlaces = wireGroupPlaces(steps);
  const railed = groupPlaces.some(Boolean);

  return (
    <div className="mt-1.5 space-y-1">
      {drift !== null && (
        <p className="text-[11px] leading-tight text-signal-caution">
          {drift === 0
            ? "Frozen steps match the template."
            : `${drift} ${drift === 1 ? "step no longer matches" : "steps no longer match"} ` +
              `“${source?.name}”. A scheduled run uses what is frozen below — ` +
              "delete and re-create the schedule to pick up the current template."}
        </p>
      )}

      <ol className="space-y-0.5">
        {steps.map((step, index) => (
          <li
            key={step.id}
            className={cn("flex items-baseline gap-2 text-[11px]", railed && "relative pl-2.5")}
          >
            <GroupRail place={groupPlaces[index] ?? null} gap="0.5" />
            <span className="readout w-3 shrink-0 text-muted-foreground">
              {index + 1}
            </span>
            <span className="instrument-label w-3 shrink-0 text-muted-foreground">
              {stepGlyph(step.type)}
            </span>
            {step.type === "MOVE" && (
              <span className="readout min-w-0 truncate">
                {step.params.x.toFixed(3)}, {step.params.y.toFixed(3)} ·{" "}
                {step.params.theta.toFixed(1)}°
              </span>
            )}
            {/* Wrapped, not truncated — the task library's rule for the same line. */}
            {step.type === "SPEAK" && (
              <span className="min-w-0 wrap-anywhere italic">
                “{step.params.text}”{repeatSuffix(step.params.repeat)}
              </span>
            )}
            {step.type === "WAIT" && (
              <span className="readout">{step.params.seconds} s</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">{children}</p>
  );
}

/** The `stale` badge for the collapsed row, so drift is visible without expanding. */
export function ScheduleSourceChip({
  schedule,
  templates,
}: {
  schedule: { task_template_id?: string | null; task_template_name?: string | null };
  templates: readonly TaskTemplate[];
}) {
  // Registered from loose steps, or before the memo carried a source.
  if (!schedule.task_template_id) {
    return <Chip tone="caution">unsaved steps</Chip>;
  }

  const source = templates.find((template) => template.id === schedule.task_template_id);
  // Information, not a fault: the schedule holds its own copy of the steps.
  if (!source) {
    return <Chip tone="neutral">source deleted</Chip>;
  }
  return <Chip tone="neutral">{schedule.task_template_name ?? source.name}</Chip>;
}
