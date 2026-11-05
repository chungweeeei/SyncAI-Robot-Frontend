"use client";

import { BotIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { CoordCell, cardHeader } from "@/components/dashboard/overlay-card";
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
    <section aria-label="Pose" className={cn(overlayPanel, "w-[17rem] max-w-[calc(100vw-1.5rem)] p-2.5", className)}>
      <div className={cardHeader}>
        <BotIcon className="size-3.5 shrink-0 text-signal-live" aria-hidden />
        <h2 className="min-w-0 flex-1 truncate text-sm font-medium">Robot</h2>
      </div>
      {/* The stop and goal cards' grid, in the live hue, with the heading a
        * fourth cell: this card has the width, and where the robot faces is
        * read here, where a stop's is read off its arrow. */}
      <dl className="mt-2.5 grid grid-cols-[1fr_1fr_1fr_1.2fr] gap-2">
        <CoordCell label="X" value={localized ? position.x.toFixed(2) : "—"} unit="m" tone={tone} />
        <CoordCell label="Y" value={localized ? position.y.toFixed(2) : "—"} unit="m" tone={tone} />
        <CoordCell label="Z" value={localized ? position.z.toFixed(2) : "—"} unit="m" tone={tone} />
        <CoordCell
          label="Orientation"
          value={localized ? position.theta.toFixed(1) : "—"}
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
