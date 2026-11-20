"use client";

import { RobotName } from "@/components/console/robot-name";
import { LogExport } from "@/components/diagnostics/log-export";
import { useRobotId } from "@/hooks/use-console-robot-state";

/**
 * The Diagnostics screen: what support asks for when something has gone
 * wrong. Its own route rather than a Settings section, since none of it is a
 * setting; a section per tool, so the next one is a heading and a card
 * under the logs. The screen owns its scroll.
 */
export function Diagnostics() {
  // The name alone: the whole frame moves every second, and with it this page.
  const robotId = useRobotId();

  return (
    <div className="h-full overflow-y-auto">
      {/* /history's width. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">Diagnostics</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gather what support needs from <RobotName id={robotId} /> when something
            has gone wrong.
          </p>
        </header>

        <section aria-labelledby="diagnostics-logs" className="space-y-3">
          <div>
            <h2 id="diagnostics-logs" className="text-base font-semibold tracking-tight">
              Logs
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Save the robot&apos;s logs to this computer, to send to support.
            </p>
          </div>
          <LogExport />
        </section>
      </div>
    </div>
  );
}
