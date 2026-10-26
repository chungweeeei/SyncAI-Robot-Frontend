"use client";

import * as React from "react";
import { PauseIcon, PencilIcon, PlayIcon, Trash2Icon } from "lucide-react";

import { Chip, Readout } from "@/components/console/instrument";
import { IconButton } from "@/components/tasks/icon-button";
import {
  ScheduleDrift,
  ScheduleSourceChip,
} from "@/components/tasks/schedule-steps";
import { ScheduleTriggerForm } from "@/components/tasks/schedule-trigger-form";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import type { ScheduleState } from "@/lib/api/schedule";
import {
  describeTrigger,
  formatLocalRunTime,
  formatUtcRunTime,
  upcomingRun,
} from "@/lib/task/schedule";
import type { TaskTemplate } from "@/lib/api/task-template";

export interface ScheduleActions {
  /** What "next" is measured from — `useSchedules().readAtMs`. */
  readAtMs: number;
  busy: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * A task's schedules, inside its card. A schedule belongs to the task it was
 * made from, so it is read, paused and deleted there rather than in a list of
 * its own down the page.
 */
export function ScheduleList({
  schedules,
  source,
  templates,
  ...actions
}: ScheduleActions & {
  schedules: readonly ScheduleState[];
  /** The task they run, compared against what each still runs; null for orphans. */
  source: TaskTemplate | null;
  /** The library, so an orphan can say why no task owns it. */
  templates: readonly TaskTemplate[];
}) {
  return (
    <ul className="space-y-1.5">
      {schedules.map((schedule) => (
        <ScheduleRow
          key={schedule.id}
          schedule={schedule}
          source={source}
          templates={templates}
          {...actions}
        />
      ))}
    </ul>
  );
}

function ScheduleRow({
  schedule,
  source,
  templates,
  readAtMs,
  busy,
  onPause,
  onResume,
  onDelete,
}: ScheduleActions & {
  schedule: ScheduleState;
  source: TaskTemplate | null;
  templates: readonly TaskTemplate[];
}) {
  const [editing, setEditing] = React.useState(false);
  const timezone = useBrowserTimeZone();

  /** See upcomingRun for paused rows and runs already past. */
  const next = upcomingRun(schedule, readAtMs);

  /**
   * On the operator's clock once the browser names it; UTC, labelled, is only
   * the server render's answer. The zone is named only when it differs from
   * the trigger's, the one case the two readouts can disagree.
   */
  const nextReadout = next
    ? timezone
      ? {
          value: formatLocalRunTime(next),
          unit:
            schedule.trigger.timezone && schedule.trigger.timezone !== timezone
              ? timezone
              : undefined,
        }
      : { value: formatUtcRunTime(next), unit: "UTC" }
    : null;

  return (
    <li className="rounded-sm border border-hairline bg-background/60 px-2 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="readout min-w-0 flex-1 truncate text-[13px]">{schedule.id}</span>

        {!source && <ScheduleSourceChip schedule={schedule} templates={templates} />}
        {schedule.paused && <Chip tone="caution">Paused</Chip>}

        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton
            label={editing ? "Close the schedule editor" : "Edit schedule"}
            disabled={busy}
            className={editing ? "bg-signal-cmd/12 text-signal-cmd" : undefined}
            onClick={() => setEditing((v) => !v)}
          >
            <PencilIcon className="size-3.5" aria-hidden />
          </IconButton>
          <IconButton
            label={schedule.paused ? "Resume schedule" : "Pause schedule"}
            disabled={busy}
            onClick={() =>
              schedule.paused ? onResume(schedule.id) : onPause(schedule.id)
            }
          >
            {schedule.paused ? (
              <PlayIcon className="size-3.5" aria-hidden />
            ) : (
              <PauseIcon className="size-3.5" aria-hidden />
            )}
          </IconButton>
          <IconButton
            label="Delete schedule"
            disabled={busy}
            className="text-signal-warn hover:bg-signal-warn/12"
            onClick={() => {
              // A confirm, since there is no undo.
              if (
                window.confirm(
                  `Delete schedule "${schedule.id}"? This cannot be undone.`,
                )
              ) {
                onDelete(schedule.id);
              }
            }}
          >
            <Trash2Icon className="size-3.5" aria-hidden />
          </IconButton>
        </div>
      </div>

      <div className="mt-1.5 space-y-1">
        <Readout
          label="Trigger"
          value={describeTrigger(schedule.trigger)}
          tone="cmd"
        />
        <Readout
          label="Next run"
          value={nextReadout?.value ?? "—"}
          unit={nextReadout?.unit}
          tone={nextReadout ? "live" : "neutral"}
        />
        {source && <ScheduleDrift scheduleId={schedule.id} source={source} />}
      </div>

      {editing && (
        <ScheduleTriggerForm schedule={schedule} onDone={() => setEditing(false)} />
      )}
    </li>
  );
}
