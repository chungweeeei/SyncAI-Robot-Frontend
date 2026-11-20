"use client";

import { TaskEditor } from "@/components/tasks/task-editor";

/**
 * Chrome only — TaskEditor owns the editing. No id in the URL: it edits the
 * tab's draft, so a reload or a trip to the map editor comes back to the job.
 */
export default function TaskEditorPage() {
  return (
    <div className="h-full overflow-y-auto">
      {/* /tasks' width, so the header does not move between the two. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <TaskEditor />
      </div>
    </div>
  );
}
