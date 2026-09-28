"use client";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { TaskEditor } from "@/components/tasks/task-editor";

/**
 * Chrome only — TaskEditor owns the steps, saving, dispatching and scheduling.
 * No id in the URL: what is being edited is the tab's draft, which the
 * overview writes before it navigates here, so a reload or a trip to the map
 * editor comes back to the same job.
 */
export default function TaskEditorPage() {
  const { state } = useConsoleRobotState();

  return (
    // This screen owns its scroll, like /tasks; the scroller is also the
    // containing block the editor's sticky column sticks to.
    <div className="h-full overflow-y-auto">
      {/* Wider than /maps' max-w-5xl, because the editor is two columns: the
       * step rows keep roughly a 3xl while the pane that names and dispatches
       * them takes 22rem beside it. Below lg the grid collapses and this is
       * just a wide-ish single column. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <TaskEditor robotId={state?.robot_id ?? null} />
      </div>
    </div>
  );
}
