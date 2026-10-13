"use client";

import * as React from "react";
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PauseIcon,
  PencilIcon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";

import { Chip, Readout } from "@/components/console/instrument";
import { IconButton } from "@/components/tasks/icon-button";
import {
  ScheduleSourceChip,
  ScheduleSteps,
} from "@/components/tasks/schedule-steps";
import { ScheduleTriggerForm } from "@/components/tasks/schedule-trigger-form";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import type { SchedulesStatus } from "@/hooks/use-schedules";
import type { ScheduleState } from "@/lib/api/schedule";
import {
  describeTrigger,
  formatLocalRunTime,
  formatUtcRunTime,
  upcomingRun,
} from "@/lib/task/schedule";
import type { TaskTemplate } from "@/lib/api/task-template";
import { cn } from "@/lib/utils";

export interface ScheduleListProps {
  schedules: ScheduleState[];
  /** The library, so a row can be diffed against the template it was frozen from. */
  templates: TaskTemplate[];
  /** What "next" is measured from — `useSchedules().readAtMs`. */
  readAtMs: number;
  status: SchedulesStatus;
  busy: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  /** The saved job whose schedules to light, from its row's clock chip. */
  highlightTemplateId?: string | null;
}

export function ScheduleList({
  schedules,
  templates,
  readAtMs,
  status,
  busy,
  onPause,
  onResume,
  onDelete,
  highlightTemplateId = null,
}: ScheduleListProps) {
  if (status === "loading") {
    return (
      <p className="text-[11px] leading-tight text-muted-foreground">
        Loading schedules…
      </p>
    );
  }

  if (status === "error") {
    return (
      <p className="text-[11px] leading-tight text-muted-foreground">
        The schedules could not be read. The message is above.
      </p>
    );
  }

  if (!schedules.length) {
    // Not the bordered Notice: inside an InstrumentGroup it is a box in a box.
    return (
      <p className="text-[11px] leading-tight text-muted-foreground">
        No schedules are registered on this robot.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {schedules.map((schedule) => (
        <ScheduleRow
          key={schedule.id}
          schedule={schedule}
          templates={templates}
          readAtMs={readAtMs}
          busy={busy}
          onPause={onPause}
          onResume={onResume}
          onDelete={onDelete}
          highlighted={
            highlightTemplateId !== null &&
            schedule.task_template_id === highlightTemplateId
          }
        />
      ))}
    </ul>
  );
}

/** One schedule row, expandable to show the steps it froze at registration. */
function ScheduleRow({
  schedule,
  templates,
  readAtMs,
  busy,
  onPause,
  onResume,
  onDelete,
  highlighted,
}: {
  schedule: ScheduleState;
  templates: TaskTemplate[];
  readAtMs: number;
  busy: boolean;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
  highlighted: boolean;
}) {
  const [open, setOpen] = React.useState(false);
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

  const source =
    templates.find((template) => template.id === schedule.task_template_id) ?? null;

  return (
    <li
      // Where a job's clock chip scrolls and focuses; -1 keeps it off the tab order.
      data-template-id={schedule.task_template_id ?? undefined}
      tabIndex={-1}
      data-highlighted={highlighted || undefined}
      className={cn(
        "rounded-sm border px-2 py-2 transition-colors duration-500 outline-none",
        highlighted
          ? "border-signal-cmd/60 bg-signal-cmd/10"
          : "border-hairline bg-elevated/40",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-label={open ? "Hide frozen steps" : "Show frozen steps"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="flex size-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
        >
          {open ? (
            <ChevronDownIcon className="size-3.5" aria-hidden />
          ) : (
            <ChevronRightIcon className="size-3.5" aria-hidden />
          )}
        </button>

        <span className="readout min-w-0 flex-1 truncate text-[13px]">
          {schedule.id}
        </span>

        <ScheduleSourceChip schedule={schedule} templates={templates} />
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

      <div className="mt-1.5 space-y-1 pl-7">
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
      </div>

      {editing && (
        <div className="pl-7">
          <ScheduleTriggerForm schedule={schedule} onDone={() => setEditing(false)} />
        </div>
      )}

      {/* Mounted only while expanded, deferring the per-schedule describe RPC;
       * re-expanding re-reads, so a re-created schedule never shows old steps. */}
      {open && (
        <div className="pl-7">
          <ScheduleSteps scheduleId={schedule.id} source={source} />
        </div>
      )}
    </li>
  );
}
