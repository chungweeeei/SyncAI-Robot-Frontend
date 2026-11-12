"use client";

import { BotIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { CoordCell, cardHeader } from "@/components/dashboard/overlay-card";
import { formatDegrees, formatMetres } from "@/lib/readout";
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

  const tone = localized ? "live" : "muted";

  return (
    <section aria-label="Pose" className={cn(overlayPanel, "w-44 p-2.5 sm:w-[17rem]", className)}>
      <div className={cardHeader}>
        <BotIcon className="size-3.5 shrink-0 text-signal-live" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">Robot</h2>
      </div>
      {/* The stop and goal cards' grid, in the live hue, with the heading a
        * fourth cell: this card has the width, and where the robot faces is
        * read here, where a stop's is read off its arrow. Two rows below
        * `sm`: at its full width it reached under the floor picker. */}
      <dl className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1.2fr]">
        <CoordCell label="X" value={localized ? formatMetres(position.x) : "—"} unit="m" tone={tone} />
        <CoordCell label="Y" value={localized ? formatMetres(position.y) : "—"} unit="m" tone={tone} />
        <CoordCell label="Z" value={localized ? formatMetres(position.z) : "—"} unit="m" tone={tone} />
        <CoordCell
          label="Orientation"
          value={localized ? formatDegrees(position.theta) : "—"}
          unit="°"
          tone={tone}
        />
      </dl>
      {!localized && (
        <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
          The robot does not know where it is yet.
        </p>
      )}
    </section>
  );
}
