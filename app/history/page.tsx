"use client";

import * as React from "react";

import { TaskHistory } from "@/components/history/task-history";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";

/**
 * The job history screen: what the robot finished, how it ended — counted
 * above the list and listed below it — and, for a job still kept, what each
 * step did.
 *
 * Its own route rather than a section of /tasks. /tasks is where a job is
 * authored and started, and its right-hand column is already the running one;
 * history is looked at afterwards, often by someone who never opened the
 * editor, and a long list under the composer would push the part of that
 * screen that commands the robot off the bottom of it.
 *
 * Like /recordings, this screen owns its scroll: the shell's <main> does not.
 */
export default function HistoryPage() {
  const { state } = useConsoleRobotState();

  return (
    <div className="h-full overflow-y-auto">
      {/* /tasks' width rather than /recordings': a row carries id, outcome,
        * source and its times on one line, and a job opened from here is the
        * same job /tasks shows, so the two screens read at one width. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jobs <span className="readout">{state?.robot_id ?? "this robot"}</span>{" "}
            has finished, newest first, over the window you pick. The robot
            keeps them for a limited time, so older ones no longer appear here.
          </p>
        </header>

        {/* The filter lives in the address bar, and the hook that reads it
          * suspends during a static prerender; Next insists on a boundary
          * around it (see its useSearchParams docs). The fallback is the whole
          * screen a beat later, which is what it was anyway. */}
        <React.Suspense fallback={null}>
          <TaskHistory />
        </React.Suspense>
      </div>
    </div>
  );
}
