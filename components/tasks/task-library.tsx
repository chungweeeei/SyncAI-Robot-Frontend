"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDownIcon, ChevronRightIcon, SearchIcon } from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { Input } from "@/components/ui/input";
import type { ScheduleActions } from "@/components/tasks/schedule-list";
import { TaskTemplateRow } from "@/components/tasks/task-template-row";
import type { ScheduleState } from "@/lib/api/schedule";
import type { TaskTemplate } from "@/lib/api/task-template";
import type { TaskTemplatesStatus } from "@/hooks/use-task-templates";
import { groupTasks, type TaskGroup } from "@/lib/task/library";
import { schedulesByTemplate } from "@/lib/task/schedule";

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
  /** Why the loaded map holds its tasks' Run right now, or null; see dispatchMapLock. */
  loadedMapHold: string | null;
  onRun: (template: TaskTemplate) => void;
  onEdit: (template: TaskTemplate) => void;
  onSchedule: (template: TaskTemplate) => void;
  onDuplicate: (template: TaskTemplate) => void;
  onDelete: (template: TaskTemplate) => void;
}

/**
 * The saved tasks, grouped by the map they run on. The loaded map's group
 * and the map-free one are open, since only those can run now; another map's
 * is folded with its count, so it is there to find without crowding what the
 * robot can do. A search opens every group it matches.
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
  loadedMapHold,
  onRun,
  onEdit,
  onSchedule,
  onDuplicate,
  onDelete,
}: TaskLibraryProps) {
  const [query, setQuery] = React.useState("");
  /** Groups the operator opened or closed; the rest follow `defaultOpen`. */
  const [toggled, setToggled] = React.useState<ReadonlyMap<string, boolean>>(new Map());

  const scheduledBy = React.useMemo(() => schedulesByTemplate(schedules), [schedules]);
  const groups = React.useMemo(
    () => groupTasks(templates, activeMapName, query),
    [templates, activeMapName, query],
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

  const searching = query.trim().length > 0;
  const isOpen = (group: TaskGroup) => {
    if (searching) return true;
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
      <label className="relative block sm:max-w-xs">
        <SearchIcon
          className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search tasks"
          aria-label="Search tasks"
          className="h-8 pl-7 md:text-[13px]"
        />
      </label>

      {groups.length === 0 && <Line>No task is named like “{query.trim()}”.</Line>}

      {groups.map((group) => {
        const open = isOpen(group);
        const other = group.mapName !== null && !group.loaded;
        const hold = group.loaded ? loadedMapHold : null;
        return (
          <section
            key={group.mapName ?? NO_MAP}
            aria-label={group.mapName ? `Tasks on ${group.mapName}` : "Tasks with no map"}
            className="space-y-1.5"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <button
                type="button"
                aria-expanded={open}
                disabled={searching}
                onClick={() => toggle(group)}
                className="flex items-center gap-1.5 rounded-sm text-left disabled:cursor-default pointer-coarse:min-h-10"
              >
                {open ? (
                  <ChevronDownIcon className="size-3.5 text-muted-foreground" aria-hidden />
                ) : (
                  <ChevronRightIcon className="size-3.5 text-muted-foreground" aria-hidden />
                )}
                <span className="readout text-[13px] font-medium">
                  {group.mapName ?? "No map"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}
                </span>
              </button>
              {group.loaded && <Chip tone="live">Loaded</Chip>}
            </div>

            {/* Said once for the group, not on every card it holds. */}
            {other && (
              <p className="pl-5 text-[11px] leading-tight text-muted-foreground">
                These run once {group.mapName} is loaded; the robot has{" "}
                {activeMapName ?? "no map"} loaded.{" "}
                <Link href="/maps" className="text-foreground underline underline-offset-2">
                  Switch maps
                </Link>
              </p>
            )}
            {group.mapName === null && open && (
              <p className="pl-5 text-[11px] leading-tight text-muted-foreground">
                These move nowhere, so they run on any map.
              </p>
            )}
            {hold && (
              <p className="pl-5 text-[11px] leading-tight text-signal-caution">{hold}</p>
            )}

            {open && (
              <ul className="space-y-1.5">
                {group.tasks.map((template) => (
                  <TaskTemplateRow
                    key={template.id}
                    template={template}
                    busy={busy}
                    runBlocked={other || runDisabled || hold !== null}
                    scheduleBlocked={other}
                    schedules={scheduledBy.get(template.id) ?? EMPTY_SCHEDULES}
                    scheduleActions={scheduleActions}
                    onRun={() => onRun(template)}
                    onEdit={() => onEdit(template)}
                    onSchedule={() => onSchedule(template)}
                    onDuplicate={() => onDuplicate(template)}
                    onDelete={() => onDelete(template)}
                  />
                ))}
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
