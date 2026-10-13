"use client";

import { XIcon } from "lucide-react";

import { TaskStatusChip } from "@/components/console/task-chip";
import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { useCancelTask } from "@/hooks/use-cancel-task";
import type { ActiveTask } from "@/lib/api/task";
import { runElapsed } from "@/lib/task/run";

/**
 * Runs this tab is not following (another tab, a reload, a schedule), with a
 * way to stop them. The run this tab tracks is left out, since its library
 * row already shows it in more detail, so a non-empty banner always means
 * "something is running that you are not looking at".
 */
export function ActiveRunBanner({
  /** The run the composer is tracking, so it is not announced twice. */
  trackedTaskId,
}: {
  trackedTaskId: string | null;
}) {
  const { tasks, status, asOf } = useConsoleActiveTasks();

  const unattended = tasks.filter((task) => task.id !== trackedTaskId);

  // Silent while the poll fails: the status strip already says so.
  if (status !== "ok" || !unattended.length) return null;

  return (
    <div className="mb-4 space-y-1.5 rounded-md border border-signal-active/40 bg-signal-active/8 p-2.5">
      <p className="instrument-label text-signal-active">
        Running outside this page
      </p>
      {unattended.map((task) => (
        <ActiveRunRow key={task.id} task={task} asOf={asOf} />
      ))}
    </div>
  );
}

function ActiveRunRow({ task, asOf }: { task: ActiveTask; asOf: string | null }) {
  // One mutation per row, so two cancels do not share a busy flag or refusal.
  const cancel = useCancelTask();
  const busy = cancel.isPending;
  const error = cancel.error?.message ?? null;

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <TaskStatusChip status={task.status} />
        <span className="readout min-w-0 flex-1 truncate text-[12px]">
          {task.id}
        </span>
        {task.schedule_id && (
          <span className="instrument-label text-muted-foreground">
            via {task.schedule_id}
          </span>
        )}
        <span className="readout shrink-0 text-[11px] text-muted-foreground">
          {runElapsed(task.started_at, asOf)}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => cancel.mutate(task.id)}
          className="instrument-label flex h-6 shrink-0 items-center gap-1 rounded-sm border border-signal-warn/50 pointer-coarse:min-h-10 bg-signal-warn/12 px-2 text-signal-warn transition-colors hover:bg-signal-warn/20 disabled:opacity-50"
        >
          <XIcon className="size-3" aria-hidden />
          Cancel
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="text-[11px] leading-snug break-words text-signal-warn"
        >
          {error}
        </p>
      )}
    </div>
  );
}
