"use client";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";

/**
 * A refused Start or New map, verbatim, under the strip — it stays until the
 * next press. A refusal is the one answer kept there (by request), because the
 * button looks the same afterwards and nothing else would say the robot did
 * not act. A save's refusal stays in the save dialog.
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
