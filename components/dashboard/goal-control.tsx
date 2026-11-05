"use client";

import { NavigationIcon, SendIcon, XIcon } from "lucide-react";

import { Chip, overlayPanel } from "@/components/console/instrument";
import { TaskStatusChip } from "@/components/console/task-chip";
import { PositionGrid, cardAction, cardHeader } from "@/components/dashboard/overlay-card";
import { cn } from "@/lib/utils";
import type { GoalTask } from "@/hooks/use-goal-task";

/**
 * Read-back for the drag-a-goal flow, floating on the viewport beside the
 * drag it describes, in the arrow's cmd hue.
 *
 * No Send: release dispatches (`useGoalTask`), and a button left standing
 * would read as a step still owed. Cancel while running; a goal reached
 * clears itself (useGoalTask), and one that failed offers Retry beside Clear.
 * Laid out as the stop panel is, header, position, then actions, since the
 * one hands over to the other on Go. Presentation only.
 */
export function GoalControl({
  task,
  name = null,
  className,
}: {
  task: GoalTask;
  /** The waypoint the goal went to, or null for one set on the map. */
  name?: string | null;
  className?: string;
}) {
  const { goal, taskStatus, error, message, running, busy } = task;

  if (!goal && !taskStatus && !error) return null;

  return (
    <section aria-label="Navigation goal" className={cn(overlayPanel, "w-full p-2.5", className)}>
      <div className={cardHeader}>
        <NavigationIcon className="size-3.5 shrink-0 text-signal-cmd" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">
          {name ?? "Navigation goal"}
        </h2>
        {/* Shown while the POST is in flight too, or the drag looks inert. */}
        {busy && !taskStatus ? (
          <Chip tone="cmd">SENDING</Chip>
        ) : (
          taskStatus && <TaskStatusChip status={taskStatus} />
        )}
      </div>

      {/* No heading, as on the stop panel: the arrow on the map is it. */}
      {goal && <PositionGrid x={goal.x} y={goal.y} z={goal.z} className="mt-2.5" />}

      {(message || error) && (
        <div className="mt-2.5 space-y-1.5 text-[11px] leading-snug break-words">
          {message && <p className="text-muted-foreground">{message}</p>}
          {error && <p className="text-signal-warn">{error}</p>}
        </div>
      )}

      <div className="mt-2.5 flex gap-1.5">
        {running ? (
          <button
            type="button"
            disabled={busy || !task.cancelable}
            onClick={task.cancel}
            className={cardAction("warn")}
          >
            <XIcon className="size-3.5" aria-hidden />
            Cancel
          </button>
        ) : (
          <>
            {/* Only a retry; to re-drive a goal, drag again. A FAILED run
                whose step carried no sentence still gets one. */}
            {(error || taskStatus === "FAILED") && (
              <button
                type="button"
                disabled={busy || !goal}
                onClick={task.send}
                className={cardAction("cmd")}
              >
                <SendIcon className="size-3.5" aria-hidden />
                Retry
              </button>
            )}
            {/* Disabled while busy, so it cannot drop a goal on its way. */}
            <button
              type="button"
              disabled={busy}
              onClick={task.clear}
              className={cardAction("quiet")}
            >
              Clear
            </button>
          </>
        )}
      </div>
    </section>
  );
}
