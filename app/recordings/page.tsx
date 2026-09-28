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
      {/* /maps' width, so walking between the two libraries does not move
        * the header. */}
      <div className="mx-auto w-full max-w-5xl px-4 py-4 sm:py-8">
        <header className="mb-6">
          <h1 className="text-xl font-semibold tracking-tight">
            Recordings
          </h1>
          {/* Kept short, like /maps. What it used to spell out — a mapping
            * run lives only in the robot's memory until it is saved, so a
            * recording is the one way to rebuild a lost one — is why the
            * link points there. */}
          <p className="mt-1 text-sm text-muted-foreground">
            Sensor recordings from{" "}
            <span className="readout">{state?.robot_id ?? "this robot"}</span>.
            Record a{" "}
            <Link href="/mapping" className="underline underline-offset-2">
              mapping run
            </Link>{" "}
            so a lost map can be rebuilt.
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
