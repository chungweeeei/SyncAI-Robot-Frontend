"use client";

import { TaskEditor } from "@/components/tasks/task-editor";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";

/**
 * Chrome only — TaskEditor owns the editing. No id in the URL: it edits the
 * tab's draft, so a reload or a trip to the map editor comes back to the job.
 */
export default function TaskEditorPage() {
  const { state } = useConsoleRobotState();

  return (
    <div className="h-full overflow-y-auto">
      {/* /tasks' width, so the header does not move between the two. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <TaskEditor robotId={state?.robot_id ?? null} />
      </div>
    </div>
  );
}
