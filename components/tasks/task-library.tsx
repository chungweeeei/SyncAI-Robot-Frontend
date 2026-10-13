"use client";

import * as React from "react";

import { TaskTemplateRow } from "@/components/tasks/task-template-row";
import type { ScheduleState } from "@/lib/api/schedule";
import type { TaskTemplate } from "@/lib/api/task-template";
import type { TaskStatus, TaskStepState } from "@/lib/api/task";
import type { TaskTemplatesStatus } from "@/hooks/use-task-templates";
import { schedulesByTemplate } from "@/lib/task/schedule";

/** Shared empty list, so an unscheduled row is not a fresh prop every render. */
const EMPTY_SCHEDULES: readonly ScheduleState[] = [];

export interface TaskLibraryProps {
  /** Every saved job, any map: hiding another map's job reads as lost work. */
  templates: TaskTemplate[];
  /** Every registered schedule; matched to rows here, once. */
  schedules: readonly ScheduleState[];
  /**
   * Schedules naming no template. No row can show them, so they are counted,
   * or "no clock chip anywhere" would read as "nothing runs unattended".
   */
  unlinkedScheduleCount: number;
  status: TaskTemplatesStatus;
  busy: boolean;
  activeMapName: string | null;
  /** True while a task is running, or before the robot id is known. */
  dispatchDisabled: boolean;
  /** Why one row's map holds its Run right now, or null; see dispatchMapLock. */
  dispatchLockFor: (template: TaskTemplate) => string | null;
  /** The template the in-flight run came from, or null if it came from the editor. */
  dispatchedFromId: string | null;
  taskStatus: TaskStatus | null;
  stepStates: ReadonlyMap<string, TaskStepState>;
  onDispatch: (template: TaskTemplate) => void;
  onLoad: (template: TaskTemplate) => void;
  onSchedule: (template: TaskTemplate) => void;
  onDelete: (template: TaskTemplate) => void;
  onShowSchedules: (template: TaskTemplate) => void;
}

/**
 * The template library. Presentation only. Height-capped with its own scroll
 * from sm, as VertexList is, so a long library needs no collapse state.
 */
export function TaskLibrary({
  templates,
  schedules,
  unlinkedScheduleCount,
  status,
  busy,
  activeMapName,
  dispatchDisabled,
  dispatchLockFor,
  dispatchedFromId,
  taskStatus,
  stepStates,
  onDispatch,
  onLoad,
  onSchedule,
  onDelete,
  onShowSchedules,
}: TaskLibraryProps) {
  const scheduledBy = React.useMemo(
    () => schedulesByTemplate(schedules),
    [schedules],
  );

  if (status === "loading") {
    return (
      <p className="text-[11px] leading-tight text-muted-foreground">
        Reading the task templates…
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="text-[11px] leading-tight text-muted-foreground">
        The task templates could not be read. The message is above.
      </p>
    );
  }

  return (
    <div className="space-y-1.5">
      {templates.length === 0 ? (
        <p className="text-[11px] leading-tight text-muted-foreground">
          No saved jobs yet. Press Create task to build one.
        </p>
      ) : (
        // No cap on a phone: the page scrolls, and an inner list caught swipes.
        <ul className="space-y-1.5 sm:max-h-56 sm:overflow-y-auto">
          {templates.map((template) => (
            <TaskTemplateRow
              key={template.id}
              template={template}
              activeMapName={activeMapName}
              dispatchDisabled={dispatchDisabled}
              dispatchLock={dispatchLockFor(template)}
              busy={busy}
              taskStatus={template.id === dispatchedFromId ? taskStatus : null}
              stepStates={template.id === dispatchedFromId ? stepStates : null}
              schedules={scheduledBy.get(template.id) ?? EMPTY_SCHEDULES}
              onDispatch={() => onDispatch(template)}
              onLoad={() => onLoad(template)}
              onSchedule={() => onSchedule(template)}
              onDelete={() => onDelete(template)}
              onShowSchedules={() => onShowSchedules(template)}
            />
          ))}
        </ul>
      )}

      {/* Schedules registered from loose steps (no longer possible, but still
       * running) record no source, so no row carries their clock chip. */}
      {unlinkedScheduleCount > 0 && (
        <p className="text-[11px] leading-tight text-signal-caution">
          {unlinkedScheduleCount}{" "}
          {unlinkedScheduleCount === 1 ? "schedule runs" : "schedules run"} steps
          that were never saved as a template, so {unlinkedScheduleCount === 1 ? "it is" : "they are"}{" "}
          not shown on any row here — see Registered schedules below.
        </p>
      )}
    </div>
  );
}
