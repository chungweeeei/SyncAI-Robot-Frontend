"use client";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";

/**
 * A refused Start or New map, under the strip that was pressed.
 *
 * The strip has no room for a sentence, so the robot's refusal — verbatim —
 * lands here and stays until the next press replaces it. Only refusals: the
 * receipts a start and a reset answer with, and the floor plan line after a
 * save, were dropped from under the strip by request (2026-10). A refused
 * press is the one answer that cannot go, because the button it came from
 * looks the same after it as before, and nothing else on screen would say
 * that the robot did not act. A save's refusal is not here: it stays in the
 * save dialog, beside the name to fix.
 */
export function RunError({
  message,
  className,
}: {
  /** The backend's sentence, or null when the last press was not refused. */
  message: string | null;
  className?: string;
}) {
  if (message === null) return null;

  return (
    <p
      role="alert"
      className={cn(
        overlayPanel,
        "px-2 py-1.5 text-[11px] leading-snug break-words text-signal-warn",
        className,
      )}
    >
      {message}
    </p>
  );
}
