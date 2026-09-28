"use client";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { CreateTaskButton } from "@/components/tasks/create-task-button";
import { TaskOverview } from "@/components/tasks/task-overview";

/**
 * Chrome only — TaskOverview owns the library, a row's run and the schedules;
 * building a job is /tasks/editor, reached by Create task or a row's Edit.
 *
 * A step list survives a reload: it is saved server-side and the library is the
 * first thing on the page.
 *
 * A run in flight survives one too. `GET /api/v1/active_tasks` answers what is
 * executing on this robot, whoever started it, so a reloaded page recovers the
 * task id it never held — and with the id it gets the status chip in the
 * masthead, the banner above the library, and Cancel. That also covers a run
 * started from another console, and one a schedule fired overnight.
 *
 * What still does not survive is the *detail*: which of the steps is executing.
 * That readback is joined by step id inside `useTaskDispatch`, which only has it
 * for a task this mount dispatched, so a recovered run is reported at task level
 * only.
 */
export default function TasksPage() {
  const { state } = useConsoleRobotState();

  return (
    // Like /maps and /settings, this screen owns its scroll: the shell's <main>
    // and <body> are both overflow-hidden, so h-full plus overflow-y-auto here is
    // what gives the column a definite height to scroll inside.
    <div className="h-full overflow-y-auto">
      {/* The editor's width (see app/tasks/editor/page.tsx), so walking between
       * the two pages does not move the header. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">Tasks</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Create tasks for{" "}
              <span className="readout">{state?.robot_id ?? "this robot"}</span>,
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
