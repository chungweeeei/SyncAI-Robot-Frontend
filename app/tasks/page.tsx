"use client";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { CreateTaskButton } from "@/components/tasks/create-task-button";
import { TaskOverview } from "@/components/tasks/task-overview";
import { RobotName } from "@/components/console/robot-name";

/**
 * Chrome only — TaskOverview owns the library, a row's run and the schedules;
 * building a job is /tasks/editor.
 *
 * A run in flight survives a reload through `GET /api/v1/active_tasks`, whoever
 * started it, but the per-step readback only exists for a task this mount
 * dispatched (`useTaskDispatch`).
 */
export default function TasksPage() {
  const { state } = useConsoleRobotState();

  return (
    // The screen owns its scroll: the shell's <main> is overflow-hidden.
    <div className="h-full overflow-y-auto">
      {/* The editor's width, so the header does not move between the two pages. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create tasks for{" "}
              <RobotName id={state?.robot_id} />,
              or schedule them to run on their own.
            </p>
          </div>
          <CreateTaskButton />
        </header>

        <TaskOverview robotId={state?.robot_id ?? null} />
      </div>
    </div>
  );
}
