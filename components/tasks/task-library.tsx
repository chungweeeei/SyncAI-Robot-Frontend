"use client";

import * as React from "react";
import { ChevronDownIcon, ChevronRightIcon } from "lucide-react";

import type { ScheduleActions } from "@/components/tasks/schedule-list";
import { TaskTemplateRow } from "@/components/tasks/task-template-row";
import type { ScheduleState } from "@/lib/api/schedule";
import type { TaskTemplate } from "@/lib/api/task-template";
import type { TaskTemplatesStatus } from "@/hooks/use-task-templates";
import { groupTasks, type TaskGroup } from "@/lib/task/library";
import { schedulesByTemplate } from "@/lib/task/schedule";
import { needsLocalization } from "@/lib/task/step";
import { cn } from "@/lib/utils";

/** Shared empty list, so an unscheduled card is not a fresh prop every render. */
const EMPTY_SCHEDULES: readonly ScheduleState[] = [];

/** A Map key for the group of tasks bound to no map. */
const NO_MAP = "\u0000no-map";

export interface TaskLibraryProps {
  /** Every saved task, any map: hiding another map's task reads as lost work. */
  templates: TaskTemplate[];
  /** Every registered schedule; matched to their tasks here, once. */
  schedules: readonly ScheduleState[];
  scheduleActions: ScheduleActions;
  status: TaskTemplatesStatus;
  busy: boolean;
  activeMapName: string | null;
  /** True while a run this tab sent is in flight, the stop is engaged, or the robot is unknown. */
  runDisabled: boolean;
  /**
   * Why the robot's state holds a Run back, or null: for a task that drives
   * on the map, and for one that does not (lib/robot/readiness.ts's
   * startLock, once per kind).
   */
  runHeld: { driving: string | null; other: string | null };
  onRun: (template: TaskTemplate) => void;
  onEdit: (template: TaskTemplate) => void;
  onSchedule: (template: TaskTemplate) => void;
  onDelete: (template: TaskTemplate) => void;
}

/**
 * The saved tasks, grouped by the map they run on. The loaded map's group
 * and the map-free one are open, since only those can run now; another map's
 * is folded with its count, so it is there to find without crowding what the
 * robot can do. No search box (by request): grouping and folding is how a
 * task is found.
 *
 * No height cap: the page scrolls, and a list scrolling inside it was the
 * thing that made a task hard to find.
 */
export function TaskLibrary({
  templates,
  schedules,
  scheduleActions,
  status,
  busy,
  activeMapName,
  runDisabled,
  runHeld,
  onRun,
  onEdit,
  onSchedule,
  onDelete,
}: TaskLibraryProps) {
  /** Groups the operator opened or closed; the rest follow `defaultOpen`. */
  const [toggled, setToggled] = React.useState<ReadonlyMap<string, boolean>>(new Map());

  const scheduledBy = React.useMemo(() => schedulesByTemplate(schedules), [schedules]);
  const groups = React.useMemo(
    () => groupTasks(templates, activeMapName),
    [templates, activeMapName],
  );

  if (status === "loading") {
    return <Line>Reading the saved tasks…</Line>;
  }
  if (status === "error") {
    return <Line>The saved tasks could not be read. The message is above.</Line>;
  }
  if (templates.length === 0) {
    return <Line>No saved tasks yet. Press Create task to build one.</Line>;
  }

  const isOpen = (group: TaskGroup) => {
    const key = group.mapName ?? NO_MAP;
    return toggled.get(key) ?? (group.loaded || group.mapName === null);
  };
  const toggle = (group: TaskGroup) => {
    const key = group.mapName ?? NO_MAP;
    const next = new Map(toggled);
    next.set(key, !isOpen(group));
    setToggled(next);
  };

  return (
    <div className="space-y-3">
      {groups.map((group) => {
        const open = isOpen(group);
        const other = group.mapName !== null && !group.loaded;
        return (
          // The loaded map is framed, heading and cards together, with a
          // dot by its name rather than a "Loaded" chip (by request): the
          // frame says which cards it covers, where a chip named only the
          // heading. Every group keeps the frame's border and padding so
          // they line up.
          <section
            key={group.mapName ?? NO_MAP}
            aria-label={group.mapName ? `Tasks on ${group.mapName}` : "Tasks with no map"}
            className={cn(
              "space-y-1.5 rounded-md border p-2",
              group.loaded ? "border-signal-live/60 bg-signal-live/5" : "border-transparent",
            )}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => toggle(group)}
                className="flex items-center gap-1.5 rounded-sm text-left pointer-coarse:min-h-10"
              >
                {open ? (
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                )}
                {group.loaded && (
                  <span className="size-1.5 shrink-0 rounded-full bg-signal-live" aria-hidden />
                )}
                <span
                  className={cn(
                    "readout text-[13px] font-medium",
                    group.loaded && "text-signal-live",
                  )}
                >
                  {group.mapName ?? "No map"}
                </span>
                {group.loaded && <span className="sr-only">, the map the robot is on</span>}
                <span className="text-[11px] text-muted-foreground">
                  {group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}
                </span>
              </button>
            </div>

            {group.mapName === null && open && (
              <p className="pl-5 text-[11px] leading-tight text-muted-foreground">
                These move nowhere, so they run on any map.
              </p>
            )}

            {open && (
              <ul className="space-y-1.5">
                {group.tasks.map((template) => {
                  const held = needsLocalization(template.steps)
                    ? runHeld.driving
                    : runHeld.other;
                  return (
                  <TaskTemplateRow
                    key={template.id}
                    template={template}
                    busy={busy}
                    runBlocked={other || runDisabled || held !== null}
                    runHeldReason={held}
                    scheduleBlocked={other}
                    schedules={scheduledBy.get(template.id) ?? EMPTY_SCHEDULES}
                    scheduleActions={scheduleActions}
                    onRun={() => onRun(template)}
                    onEdit={() => onEdit(template)}
                    onSchedule={() => onSchedule(template)}
                    onDelete={() => onDelete(template)}
                  />
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Line({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] leading-tight text-muted-foreground">{children}</p>;
}
