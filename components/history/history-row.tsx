"use client";

import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { TaskStatusChip } from "@/components/console/task-chip";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import { useTaskRun } from "@/hooks/use-task-run";
import type { TaskHistoryEntry } from "@/lib/api/task";
import { formatDuration } from "@/lib/recording/format";
import { runSeconds } from "@/lib/task/history";
import { formatLocalRunTime, formatUtcRunTime } from "@/lib/task/schedule";
import { cn } from "@/lib/utils";

/** One measured value in the row's right-hand cluster, as on /recordings. */
function Cell({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <span className="flex flex-col items-end">
      <span className="instrument-label text-muted-foreground">{label}</span>
      <span className="readout mt-0.5 text-[13px] leading-none font-medium">
        {value}
        {unit && (
          <span className="ml-1 text-[10px] font-normal text-muted-foreground">
            {unit}
          </span>
        )}
      </span>
    </span>
  );
}

/**
 * A job's close time on the operator's own clock once the browser has said
 * which clock that is, and UTC — labelled — for the prerender. Same trade the
 * schedule list makes for its next-run readout.
 */
function useFinishedReadout(closedAt: string | null): {
  value: string;
  unit?: string;
} {
  const timezone = useBrowserTimeZone();
  if (!closedAt) return { value: "—" };
  return timezone
    ? { value: formatLocalRunTime(closedAt) }
    : { value: formatUtcRunTime(closedAt), unit: "UTC" };
}

/**
 * What each step did, read on expand. Mounted only while the row is open, which
 * is what defers the request to a deliberate gesture.
 */
function RunSteps({ id }: { id: string }) {
  const { status, steps, error } = useTaskRun(id);

  if (status === "loading") {
    return (
      <div className="space-y-1.5" aria-busy>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-36" />
      </div>
    );
  }

  // The backend's sentence, verbatim — most often that the job has aged out of
  // what the robot keeps, which is the operator's answer as it stands.
  if (status === "error") {
    return (
      <p role="alert" className="text-[11px] leading-snug text-signal-warn">
        {error}
      </p>
    );
  }

  // The backend degrades the step list to empty rather than failing when it
  // cannot ask the job itself, so an empty list is "not available", not "the
  // job had no steps" — nothing in this console dispatches a zero-step job.
  if (!steps.length) {
    return (
      <p className="text-[11px] leading-tight text-muted-foreground">
        Step results are not available for this job.
      </p>
    );
  }

  return (
    <ol className="space-y-1">
      {steps.map((step, index) => (
        <li key={step.id} className="space-y-0.5">
          <div className="flex items-center gap-2">
            <span className="readout w-5 shrink-0 text-right text-[11px] text-muted-foreground">
              {index + 1}
            </span>
            <span className="readout min-w-0 flex-1 truncate text-[12px]">
              {step.id}
            </span>
            <TaskStatusChip status={step.status} />
          </div>
          {step.error_msg && (
            <p className="pl-7 text-[11px] leading-snug break-words text-signal-warn">
              {step.error_msg}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * Who started the job, under its id. The id is the row's title because it is
 * what the job is called everywhere else — the running banner on /tasks, a
 * support conversation — so the history has to answer to the same name.
 */
function sourceLabel(entry: TaskHistoryEntry): string {
  return entry.schedule_id ? `Scheduled · ${entry.schedule_id}` : "Started directly";
}

export function HistoryRow({ entry }: { entry: TaskHistoryEntry }) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const finished = useFinishedReadout(entry.closed_at);
  const seconds = runSeconds(entry.started_at, entry.closed_at);

  return (
    <li>
      {/* The whole row is the disclosure, so there is no small target to hunt
        * for. Its name is its visible text — id, status, source, times — which is
        * also what a screen-reader user needs to pick the row out. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/60"
      >
        <TaskStatusChip status={entry.status} />
        <span className="min-w-0 flex-1">
          <span className="readout block truncate text-sm font-medium">
            {entry.id}
          </span>
          <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
            {sourceLabel(entry)}
          </span>
        </span>

        {/* A missing close time is an em dash, not a zero — a zero would be a
          * claim about the job. */}
        <span className="flex shrink-0 items-start gap-4">
          <Cell label="Finished" value={finished.value} unit={finished.unit} />
          <Cell
            label="Took"
            value={seconds === null ? "—" : formatDuration(seconds)}
          />
        </span>

        <ChevronDownIcon
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            !open && "-rotate-90",
          )}
        />
      </button>

      {open && (
        <div id={panelId} className="px-4 pb-3">
          <RunSteps id={entry.id} />
        </div>
      )}
    </li>
  );
}
