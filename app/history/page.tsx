"use client";

import { TaskHistory } from "@/components/history/task-history";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";

/**
 * The job history screen: what the robot finished, how it ended, and — for a
 * job still kept — what each step did.
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
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <header className="mb-6">
          <p className="instrument-label text-muted-foreground">Robot</p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jobs <span className="readout">{state?.robot_id ?? "this robot"}</span>{" "}
            has finished, newest first. The robot keeps them for a limited
            time, so older ones no longer appear here.
          </p>
        </header>

        <TaskHistory />
      </div>
    </div>
  );
}
