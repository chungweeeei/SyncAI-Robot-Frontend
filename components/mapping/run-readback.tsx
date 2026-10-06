"use client";

import { overlayPanel } from "@/components/console/instrument";
import { ConversionLine } from "@/components/mapping/conversion-line";
import type { MapSummary } from "@/lib/types/map";
import { cn } from "@/lib/utils";

/**
 * What the last run control said, under the strip that said it.
 *
 * Start, Save and New map each answer with a sentence — the robot's own,
 * verbatim: the stillness warning after a start, the receipt after a save, a
 * refusal — and the strip has no room for a sentence. So the last one lands
 * here, where the dashboard parks its goal read-back, and stays until the
 * next press replaces it. The page decides which press that was; this panel
 * only draws it.
 *
 * `role` follows the tone: a refusal is an alert, a receipt is a status. Both
 * are live regions, so a screen reader hears the robot's answer land the way
 * a sighted operator sees it appear.
 */
export function RunReadback({
  message,
  tone,
  conversion,
  className,
}: {
  /** The backend's sentence, or null when nothing has spoken since the last clear. */
  message: string | null;
  tone: "live" | "warn";
  /** The map whose floor plan is being built off the last save, if any. */
  conversion: MapSummary | null;
  className?: string;
}) {
  if (message === null && conversion === null) return null;

  return (
    <div
      className={cn(
        overlayPanel,
        "space-y-1 px-2 py-1.5 text-[11px] leading-snug break-words",
        className,
      )}
    >
      {message !== null && (
        <p
          role={tone === "warn" ? "alert" : "status"}
          className={tone === "warn" ? "text-signal-warn" : "text-signal-live"}
        >
          {message}
        </p>
      )}
      {/* Under the save's sentence, not replacing it: the two say different
        * things — that the cloud is on disk (permanent, and the thing that
        * makes the run safe to leave) and how the grid built from it went. */}
      <ConversionLine map={conversion} />
    </div>
  );
}
