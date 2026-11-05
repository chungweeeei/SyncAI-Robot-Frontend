"use client";

import * as React from "react";
import { ChevronDownIcon, RotateCcwIcon } from "lucide-react";

import { TaskStatusChip } from "@/components/console/task-chip";
import { GroupRail } from "@/components/tasks/group-rail";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserTimeZone } from "@/hooks/use-browser-time-zone";
import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { useTaskContinue } from "@/hooks/use-task-continue";
import { useTaskRun } from "@/hooks/use-task-run";
import type { TaskHistoryEntry, TaskStepState } from "@/lib/api/task";
import { formatDuration } from "@/lib/recording/format";
import { stepFailureText } from "@/lib/task/failure";
import {
  continuationKind,
  continuationStart,
  describeRun,
  runSeconds,
  stepSeconds,
} from "@/lib/task/history";
import { formatLocalRunTime, formatUtcRunTime } from "@/lib/task/schedule";
import { wireGroupPlaces } from "@/lib/task/step";
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
 * A job's close time on the operator's clock once the browser has said which,
 * and labelled UTC for the prerender.
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
 * Run a failed job again from the step it failed at, as a new job the
 * masthead then follows. The steps before it are not run again; the new job
 * lists them as SKIPPED. Greyed, with the reason on hover, while anything
 * would make the robot refuse it; the backend's own sentence otherwise.
 */
function RetryFromFailure({
  entry,
  steps,
}: {
  entry: TaskHistoryEntry;
  steps: readonly TaskStepState[];
}) {
  const start = continuationStart(steps);
  const { state } = useConsoleRobotState();
  const { engaged: stopped } = useConsoleEstop();
  const { tasks, status } = useConsoleActiveTasks();
  const send = useTaskContinue();

  if (!start) return null;

  const robotId = state?.robot_id ?? null;
  const blocked =
    robotId === null
      ? "The robot cannot be reached."
      : stopped
        ? "The emergency stop is engaged."
        : status !== "ok"
          ? "Whether a job is running cannot be read."
          : tasks.length > 0
            ? "Another job is running; it has to finish first."
            : null;

  return (
    <div className="space-y-1.5 pt-1">
      <Button
        size="sm"
        variant="outline"
        title={
          blocked ??
          `Run this job again from step ${start.ordinal}; the steps before it are not run again.`
        }
        // Once sent, the job is the new one's to follow, not this one's to send again.
        disabled={blocked !== null || send.isPending || send.isSuccess}
        onClick={() => {
          if (!robotId) return;
          // mutate, not mutateAsync: the refusal is read off `send.error`.
          send.mutate({
            robot: robotId,
            failedId: entry.id,
            kind: continuationKind(entry.kind),
            name: entry.name,
          });
        }}
      >
        <RotateCcwIcon data-icon="inline-start" aria-hidden />
        Retry from step {start.ordinal}
      </Button>
      {send.error && (
        <p role="alert" className="text-[11px] leading-snug break-words text-signal-warn">
          {send.error.message}
        </p>
      )}
      {send.data && (
        <p role="status" className="text-[11px] leading-snug text-muted-foreground">
          Sent as <span className="readout">{send.data}</span>. Follow it on the bar above.
        </p>
      )}
    </div>
  );
}

/** What each step did. Mounted only while the row is open, so it is read on demand. */
function RunSteps({ entry }: { entry: TaskHistoryEntry }) {
  const { status, steps, error } = useTaskRun(entry.id);

  if (status === "loading") {
    return (
      <div className="space-y-1.5" aria-busy>
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-4 w-36" />
      </div>
    );
  }

  // The backend's sentence — most often that the job has aged out.
  if (status === "error") {
    return (
      <p role="alert" className="text-[11px] leading-snug text-signal-warn">
        {error}
      </p>
    );
  }

  // The backend answers an empty step list when it can't ask the job, so empty
  // means "not available" — this console never dispatches a zero-step job.
  if (!steps.length) {
    return (
      <p className="text-[11px] leading-tight text-muted-foreground">
        Step results are not available for this job.
      </p>
    );
  }

  const groupPlaces = wireGroupPlaces(steps);
  const railed = groupPlaces.some(Boolean);
  return (
    <>
      <ol className="space-y-1">
        {steps.map((step, index) => {
          const took = stepSeconds(step);
          return (
            <li key={step.id} className={cn("space-y-0.5", railed && "relative pl-2.5")}>
              <GroupRail place={groupPlaces[index] ?? null} gap="1" />
              <div className="flex items-center gap-2">
                <span className="readout w-5 shrink-0 text-right text-[11px] text-muted-foreground">
                  {index + 1}
                </span>
                <span className="readout min-w-0 flex-1 truncate text-[12px]">
                  {step.id}
                </span>
                {/* The step's own time; a hold while it ran is said beside it,
                  * not counted in it. Nothing for a step that never ran. */}
                {took && (
                  <span className="readout shrink-0 text-[11px] text-muted-foreground">
                    {formatDuration(took.active)}
                    {took.paused > 0 && ` · held ${formatDuration(took.paused)}`}
                  </span>
                )}
                <TaskStatusChip status={step.status} />
              </div>
              {step.error_msg && (
                <p className="pl-7 text-[11px] leading-snug break-words text-signal-warn">
                  {stepFailureText(step.error_msg)}
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {entry.status === "FAILED" && <RetryFromFailure entry={entry} steps={steps} />}
    </>
  );
}

export function HistoryRow({ entry }: { entry: TaskHistoryEntry }) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const finished = useFinishedReadout(entry.closed_at);
  const seconds = runSeconds(entry.started_at, entry.closed_at);
  // See describeRun. The id is also in the detail below, for the orchestrator's log.
  const { title, detail } = describeRun(entry);
  const titledById = title === entry.id;

  return (
    <li>
      {/* The whole row is the disclosure; its name is its visible text. */}
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title={entry.id}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-elevated/60"
      >
        <TaskStatusChip status={entry.status} />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block text-sm font-medium",
              // An id truncates (its tail is a sequence number); a name wraps,
              // or a phone shows "Morni…".
              titledById ? "readout truncate" : "break-words",
            )}
          >
            {title}
          </span>
          <span className="mt-0.5 block text-[11px] leading-tight text-muted-foreground">
            {detail}
          </span>
        </span>

        {/* A missing close time is an em dash, not a zero. */}
        <span className="flex shrink-0 items-start gap-3 sm:gap-4">
          <Cell label="Finished" value={finished.value} unit={finished.unit} />
          {/* Took is hidden below sm, where it made the title truncate; the
            * duration is still in the expanded detail. */}
          <span className="hidden sm:flex">
            <Cell
              label="Took"
              value={seconds === null ? "—" : formatDuration(seconds)}
            />
          </span>
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
        <div id={panelId} className="space-y-2 px-4 pb-3">
          {/* The id, for the orchestrator's log; skipped when it is the title. */}
          {!titledById && (
            <div className="flex items-baseline gap-2">
              <span className="instrument-label shrink-0 text-muted-foreground">Job id</span>
              <span className="readout min-w-0 truncate text-[12px]">{entry.id}</span>
            </div>
          )}
          {/* Coordinates only mean something on one map, and a site with
            * several is where "it went to the wrong place" gets asked. */}
          {entry.map_name && (
            <div className="flex items-baseline gap-2">
              <span className="instrument-label shrink-0 text-muted-foreground">Map</span>
              <span className="readout min-w-0 truncate text-[12px]">{entry.map_name}</span>
            </div>
          )}
          <RunSteps entry={entry} />
        </div>
      )}
    </li>
  );
}
