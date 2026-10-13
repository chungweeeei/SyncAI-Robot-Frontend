"use client";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import type { RobotState } from "@/lib/types/robot";

/**
 * Where the robot is, over the viewport's corner beside the map it is read
 * against. From the 1 Hz state, not the ~20 Hz feed: a number changing twenty
 * times a second cannot be read, and that rate of render is what the feed avoids.
 */
export function PoseOverlay({
  state,
  className,
}: {
  state: RobotState;
  className?: string;
}) {
  const { position } = state.localization_status;
  // A false flag means zeroed placeholders (before localization, and while
  // mapping). Masked, since 0.00 would read as standing on the map origin.
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
