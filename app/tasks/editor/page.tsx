"use client";

import { TaskEditor } from "@/components/tasks/task-editor";

/**
 * Chrome only — TaskEditor owns the steps, the name, saving and deleting.
 * No id in the URL: what is being edited is the tab's draft, which the
 * overview writes before it navigates here, so a reload or a trip to the map
 * editor comes back to the same job.
 */
export default function TaskEditorPage() {
  return (
    // This screen owns its scroll, like /tasks.
    <div className="h-full overflow-y-auto">
      {/* /tasks' width, so walking between the two does not move the
       * header. The step list is the whole page now that the name is the
       * heading and scheduling lives on /tasks. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <TaskEditor />
      </div>
    </div>
  );
}
