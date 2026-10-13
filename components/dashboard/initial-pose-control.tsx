"use client";

import { RadioTowerIcon } from "lucide-react";

import { Chip, Readout, overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import type { InitialPoseEstimate } from "@/hooks/use-initial-pose";

/**
 * Read-back for the initial-pose drag: what was published on release.
 *
 * Shaped like the goal read-back but in the caution hue: a wrong initial pose
 * does not send the robot astray, it silently makes the whole map frame
 * wrong, so it must never be mistaken for a goal mid-drag.
 *
 * No Send: release publishes, and the button here is only a retry after a
 * failure. A success expires on its own (useInitialPose); a failure stays,
 * since its error and Retry live here. Presentation only.
 */
export function InitialPoseControl({
  estimate,
  className,
}: {
  estimate: InitialPoseEstimate;
  className?: string;
}) {
  const { pose, published, busy, error } = estimate;

  if (!pose && !error) return null;

  return (
    <div className={cn(overlayPanel, "w-full p-2.5", className)}>
      {pose && (
        <div className="space-y-1">
          <Readout
            label="X"
            value={pose.x.toFixed(2)}
            unit="m"
            tone="caution"
          />
          <Readout
            label="Y"
            value={pose.y.toFixed(2)}
            unit="m"
            tone="caution"
          />
          <Readout
            label="Orientation"
            value={pose.theta.toFixed(1)}
            unit="°"
            tone="caution"
          />
        </div>
      )}

      {/* "Sent", not "Localized": the estimate is only a seed with no ack.
        * Whether it converged shows as the robot moving to the marker. This
        * row is the only sign the request went out, so it shows in-flight
        * and failed too. */}
      {(busy || published || error) && (
        <div className="mt-2.5 flex items-center justify-between gap-2">
          <span className="instrument-label text-muted-foreground">
            Estimate
          </span>
          {busy ? (
            <Chip tone="caution">Sending</Chip>
          ) : error ? (
            <Chip tone="warn">Failed</Chip>
          ) : (
            <Chip tone="live">Sent</Chip>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2.5 text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}

      <div className="mt-2.5 flex gap-1.5">
        {/* Only a retry: a button shown otherwise reads as a step still owed. */}
        {error && (
          <button
            type="button"
            disabled={busy || !pose}
            onClick={estimate.publish}
            className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-caution/50 bg-signal-caution/12 text-signal-caution transition-colors hover:bg-signal-caution/20 disabled:opacity-50"
          >
            <RadioTowerIcon className="size-3.5" />
            Retry
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={estimate.clear}
          className="instrument-label h-7 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground disabled:opacity-50"
        >
          Clear
        </button>
      </div>
    </div>
  );
}
