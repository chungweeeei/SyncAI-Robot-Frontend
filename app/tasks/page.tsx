"use client";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { CreateTaskButton } from "@/components/tasks/create-task-button";
import { TaskOverview } from "@/components/tasks/task-overview";
import { RobotName } from "@/components/console/robot-name";

/**
 * Chrome only — TaskOverview owns the saved tasks, their Run and their
 * schedules; building a task is /tasks/editor, and following a run is the
 * masthead's.
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
              <RobotName id={state?.robot_id} />, run one now, or schedule it to
              run on its own.
            </p>
          </div>
          <CreateTaskButton />
        </header>

        <TaskOverview robotId={state?.robot_id ?? null} />
      </div>
    </div>
  );
}
