"use client";

import { SendIcon, XIcon } from "lucide-react";

import { Chip, Readout, overlayPanel } from "@/components/console/instrument";
import { TaskStatusChip } from "@/components/console/task-chip";
import { cn } from "@/lib/utils";
import type { GoalTask } from "@/hooks/use-goal-task";

/**
 * Read-back for the drag-a-goal flow, floating on the viewport beside the
 * drag it describes, in the arrow's cmd hue.
 *
 * No Send: release dispatches (`useGoalTask`), and a button left standing
 * would read as a step still owed. Cancel while running, Clear after, and
 * Retry only when the submit failed. Presentation only.
 */
export function GoalControl({
  task,
  className,
}: {
  task: GoalTask;
  className?: string;
}) {
  const { goal, taskStatus, error, message, running, busy } = task;

  if (!goal && !taskStatus && !error) return null;

  return (
    <div className={cn(overlayPanel, "w-full p-2.5", className)}>
      {goal && (
        <div className="space-y-1">
          <Readout label="Goal X" value={goal.x.toFixed(2)} unit="m" tone="cmd" />
          <Readout label="Goal Y" value={goal.y.toFixed(2)} unit="m" tone="cmd" />
          <Readout
            label="Orientation"
            value={goal.theta.toFixed(1)}
            unit="°"
            tone="cmd"
          />
        </div>
      )}

      {/* Shown while the POST is in flight too, or the drag looks inert. */}
      {(taskStatus || busy) && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="instrument-label text-muted-foreground">
            Task
          </span>
          {busy && !taskStatus ? (
            <Chip tone="cmd">SENDING</Chip>
          ) : (
            taskStatus && <TaskStatusChip status={taskStatus} />
          )}
        </div>
      )}

      {message && (
        <p className="mt-1.5 text-[11px] leading-snug break-words text-muted-foreground">
          {message}
        </p>
      )}

      {error && (
        <p className="mt-2.5 text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}

      <div className="mt-2.5 flex gap-1.5">
        {running ? (
          <button
            type="button"
            disabled={busy || !task.cancelable}
            onClick={task.cancel}
            className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-warn/50 bg-signal-warn/12 text-signal-warn transition-colors hover:bg-signal-warn/20 disabled:opacity-50"
          >
            <XIcon className="size-3.5" />
            Cancel
          </button>
        ) : (
          <>
            {/* Only a retry; to re-drive a goal, drag again. */}
            {error && (
              <button
                type="button"
                disabled={busy || !goal}
                onClick={task.send}
                className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd transition-colors hover:bg-signal-cmd/20 disabled:opacity-50"
              >
                <SendIcon className="size-3.5" />
                Retry
              </button>
            )}
            {/* Disabled while busy, so it cannot drop a goal on its way. */}
            <button
              type="button"
              disabled={busy}
              onClick={task.clear}
              className="instrument-label h-7 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-50"
            >
              Clear
            </button>
          </>
        )}
      </div>
    </div>
  );
}
