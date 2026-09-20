"use client";

import Link from "next/link";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { RecorderControl } from "@/components/recordings/recorder-control";
import { RecordingList } from "@/components/recordings/recording-list";

/**
 * The recording screen: start a bag, watch it grow, and manage what is on disk.
 *
 * Its own route rather than a panel on /mapping, though mapping is what it
 * exists for. A recording outlives the page that started it and outlives the
 * mode the robot is in, so it cannot live on a screen that is only meaningful
 * in MANUAL — and the half of this page that is a catalogue has nothing to do
 * with a run in progress at all.
 *
 * Like /maps and /settings, this screen owns its scroll: the shell's <main>
 * does not.
 */
export default function RecordingsPage() {
  const { state } = useConsoleRobotState();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl px-4 py-8">
        <header className="mb-6">
          <p className="instrument-label text-muted-foreground">Robot</p>
          <h1 className="mt-1.5 text-xl font-semibold tracking-tight">
            Recordings
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Sensor recordings from{" "}
            <span className="readout">{state?.robot_id ?? "this robot"}</span>,
            kept until you delete them. A recording is a safety net rather than
            something to play back here. The run worth recording is a{" "}
            <Link href="/mapping" className="underline underline-offset-2">
              mapping run
            </Link>
            : until a new map is saved it exists only in the robot&apos;s
            memory, and a recording is the only way to rebuild one that was
            lost.
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
