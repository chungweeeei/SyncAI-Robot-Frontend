"use client";

import * as React from "react";

import { TaskHistory } from "@/components/history/task-history";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { RobotName } from "@/components/console/robot-name";

/**
 * The job history screen: what the robot finished and how it ended. Its own
 * route, not part of /tasks, so a long list never pushes the controls that
 * command the robot off screen. The screen owns its scroll.
 */
export default function HistoryPage() {
  const { state } = useConsoleRobotState();

  return (
    <div className="h-full overflow-y-auto">
      {/* /tasks' width: a row carries its outcome, source and times on one line. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">History</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Jobs <RobotName id={state?.robot_id} />{" "}
            has finished, newest first, over the window you pick. The robot
            keeps them for a limited time, so older ones no longer appear here.
          </p>
        </header>

        {/* The filter's useSearchParams suspends during a static prerender,
          * and Next requires a boundary around it. */}
        <React.Suspense fallback={null}>
          <TaskHistory />
        </React.Suspense>
      </div>
    </div>
  );
}
