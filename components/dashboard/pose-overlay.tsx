"use client";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import type { RobotState } from "@/lib/types/robot";

/**
 * Where the robot is, laid over the viewport's bottom-left corner.
 *
 * It used to head the telemetry rail, which put the two numbers an operator
 * reads against the map a screen-width away from the map. Over the corner they
 * sit next to the marker they describe, and the rail keeps the controls.
 *
 * Read off the console's 1 Hz state like the rail, not the canvas's ~20 Hz
 * feed: a readout that changes twenty times a second cannot be read, and
 * re-rendering React at that rate is what the feed exists to avoid.
 */
export function PoseOverlay({
  state,
  className,
}: {
  state: RobotState;
  className?: string;
}) {
  const { position } = state.localization_status;
  // A false flag means the pose fields are a zeroed placeholder, not a
  // reading — a state frame arrives before the localizer converges (and all
  // through a mapping run) now that the backend no longer withholds it. The
  // numbers are masked rather than shown at 0.00: a dash cannot be misread as
  // the robot standing on the map origin.
  const localized = state.localization_valid;

  return (
    <section
      aria-label="Pose"
      className={cn(overlayPanel, "px-3 py-2", className)}
    >
      <dl className="flex items-baseline gap-4">
        <PoseValue
          label="X"
          value={localized ? position.x.toFixed(2) : "—"}
          unit="m"
          live={localized}
        />
        <PoseValue
          label="Y"
          value={localized ? position.y.toFixed(2) : "—"}
          unit="m"
          live={localized}
        />
        <PoseValue
          label="Orientation"
          value={localized ? position.theta.toFixed(1) : "—"}
          unit="°"
          live={localized}
        />
      </dl>
      {!localized && (
        <p className="mt-1.5 text-[11px] leading-tight text-muted-foreground">
          The robot does not know where it is yet.
        </p>
      )}
    </section>
  );
}

function PoseValue({
  label,
  value,
  unit,
  live,
}: {
  label: string;
  value: string;
  unit: string;
  live: boolean;
}) {
  return (
    <div>
      <dt className="instrument-label text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "readout mt-0.5 text-lg leading-none font-medium tabular-nums",
          live ? "text-signal-live" : "text-muted-foreground",
        )}
      >
        {value}
        <span className="ml-0.5 text-[11px] font-normal text-muted-foreground">
          {unit}
        </span>
      </dd>
    </div>
  );
}
