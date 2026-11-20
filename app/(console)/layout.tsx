import type { Metadata } from "next";

import { ActiveTaskProvider } from "@/components/console/active-task-provider";
import { EstopProvider } from "@/components/console/estop-provider";
import { FaultBoundary } from "@/components/console/fault-boundary";
import { NavRail } from "@/components/console/nav-rail";
import { RobotStateProvider } from "@/components/console/robot-state-provider";
import { SessionGate } from "@/components/console/session-gate";
import { StatusStrip } from "@/components/console/status-strip";
import { pageTitle } from "@/lib/page-title";

export const metadata: Metadata = {
  // The dashboard's, since it is this group's own page; every other screen
  // writes its own beside it.
  title: pageTitle("Dashboard"),
};

/**
 * Every screen but /login: the sign-in gate, then the console's polls and its
 * shell. The gate is outside the polls on purpose, so nothing asks the robot
 * anything (and no socket opens) until there is a token to ask with, and a
 * sign-out unmounts all of it, sockets included, rather than leaving them
 * reconnecting with no token every two seconds.
 */
export default function ConsoleLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionGate>
      {/*
       * The console's two polls, mounted once so every screen reads the
       * same snapshot and the job state survives navigation. Separate
       * providers because they fail differently (see ActiveTaskProvider).
       */}
      <RobotStateProvider>
        <ActiveTaskProvider>
          {/* Inside both polls: the stop reads the robot's lock from the
            * first and the jobs to cancel from the second. */}
          <EstopProvider>
            <div className="flex h-dvh flex-col lg:flex-row">
              {/* The rail is chrome around the stop, not the stop:
                * a throw in it must not reach global-error. */}
              <FaultBoundary title="Menu unavailable" compact>
                <NavRail />
              </FaultBoundary>
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <StatusStrip />
                {/* Pages own their scrolling. */}
                <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
              </div>
            </div>
          </EstopProvider>
        </ActiveTaskProvider>
      </RobotStateProvider>
    </SessionGate>
  );
}
