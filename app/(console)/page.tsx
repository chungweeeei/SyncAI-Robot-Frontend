"use client";

import dynamic from "next/dynamic";
import { RadarIcon } from "lucide-react";

import {
  useConsoleRobotState,
  useRobotId,
  useRobotStateStatus,
} from "@/hooks/use-console-robot-state";
import { PoseOverlay } from "@/components/dashboard/pose-overlay";
import { TelemetryRail } from "@/components/dashboard/telemetry-rail";
import { cn } from "@/lib/utils";

/**
 * Loaded after the shell, in its own chunk: the 3D library is most of this
 * route's script, and the strip's stop should not wait on it to hydrate.
 * Client-only, since a WebGL view has nothing to prerender. The blank fills
 * the section, whose height is definite, so nothing moves when it arrives.
 */
const PointCloudView = dynamic(
  () => import("@/components/dashboard/pointcloud-view").then((mod) => mod.PointCloudView),
  { ssr: false, loading: () => <div aria-hidden className="h-full w-full" /> },
);

/**
 * The operator screen: the viewport takes every pixel the strip and the rail
 * do not need, and from lg the page never scrolls.
 */
export default function DashboardPage() {
  // The name and the status alone, so the viewport under this page is not
  // re-rendered by each second's frame; the two readouts that show the frame
  // read it themselves.
  const robotId = useRobotId();
  const status = useRobotStateStatus();

  if (robotId === null) {
    return <AwaitingTelemetry connecting={status === "loading"} />;
  }

  // Below lg the rail stacks under the viewport and the whole screen scrolls;
  // from lg it is a side rail and nothing scrolls but the rail itself.
  return (
    <div className="flex h-full flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
      <section
        aria-label="Map viewport"
        // A definite height at every breakpoint, since the canvas sizes from
        // its container. svh, not vh: 55vh of the largest viewport put the rail
        // under the browser chrome. A phone held sideways gets the whole of
        // <main>: 55% of ~375 px was a 200 px map with its overlays colliding.
        className="relative h-[55svh] shrink-0 short:h-full lg:h-full lg:flex-1"
      >
        {/* The canvas draws the pose from its own ~20 Hz socket, not this
          * page's 1 Hz state. */}
        <PointCloudView robotId={robotId} />
        {/* Pointer-transparent so the scene under it still takes a drag.
          * Bottom-right stays free for the drive panel. */}
        <LivePoseOverlay
          // Not on a phone held sideways: the corner belongs to the panels
          // stacked down the left, and the strip's map view has the pose.
          className="pointer-events-none absolute bottom-3 left-3 short:hidden"
        />
      </section>

      <aside
        aria-label="Telemetry"
        className="w-full shrink-0 border-t border-hairline bg-panel lg:h-full lg:w-72 lg:overflow-y-auto lg:border-t-0 lg:border-l 2xl:w-80"
      >
        <LiveTelemetryRail />
      </aside>
    </div>
  );
}

/** The pose readout on the console's 1 Hz frame; nothing before the first. */
function LivePoseOverlay({ className }: { className?: string }) {
  const { state } = useConsoleRobotState();
  return state ? <PoseOverlay state={state} className={className} /> : null;
}

function LiveTelemetryRail() {
  const { state } = useConsoleRobotState();
  return state ? <TelemetryRail state={state} /> : null;
}

/**
 * No-telemetry state, written for whoever stands at the robot: it names what
 * they can check (power, network, start-up), never an endpoint or a service.
 */
function AwaitingTelemetry({ connecting }: { connecting: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-8">
      <div className="max-w-sm text-center">
        <RadarIcon
          aria-hidden
          className={cn(
            "mx-auto size-8",
            // No animation on the error state: it would read as progress.
            connecting
              ? "animate-pulse text-signal-cmd motion-reduce:animate-none"
              : "text-signal-caution",
          )}
        />
        <h1 className="instrument-label mt-4 text-muted-foreground">
          {connecting ? "Connecting" : "No signal from the robot"}
        </h1>
        <p className="mt-2 text-sm text-foreground">
          {connecting
            ? "Waiting for the robot to report in."
            : "This console cannot reach the robot."}
        </p>
        {!connecting && (
          <p className="mt-3 text-xs text-muted-foreground">
            Check that the robot is powered on, has finished starting up, and is
            on the same network as this computer.
          </p>
        )}
      </div>
    </div>
  );
}
