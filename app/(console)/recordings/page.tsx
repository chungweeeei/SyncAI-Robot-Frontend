"use client";

import { useRobotId } from "@/hooks/use-console-robot-state";
import { RecorderControl } from "@/components/recordings/recorder-control";
import { RecordingList } from "@/components/recordings/recording-list";
import { RobotName } from "@/components/console/robot-name";

/**
 * The recording screen: start one, watch it grow, manage what is on disk. Not
 * a panel on /mapping: a recording outlives the page and the robot's mode.
 * The screen owns its scroll.
 */
export default function RecordingsPage() {
  // The name alone: the whole frame moves every second, and with it this page.
  const robotId = useRobotId();

  return (
    <div className="h-full overflow-y-auto">
      {/* Every library screen's width, so walking between them does not move
        * the header. */}
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Recordings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sensor recordings from <RobotName id={robotId} />.
          </p>
        </header>

        <div className="space-y-6">
          <RecorderControl />

          <section>
            <h2 className="instrument-label mb-2 text-muted-foreground">
              On the robot
            </h2>
            <RecordingList />
          </section>
        </div>
      </div>
    </div>
  );
}
