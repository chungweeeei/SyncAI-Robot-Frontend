"use client";

import { RefreshCwIcon, SendIcon } from "lucide-react";

import { Chip, Readout, overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import { stepFailureText } from "@/lib/task/failure";
import type { RoutePreviewState } from "@/hooks/use-route-preview";

/**
 * What a route preview found, floating where GoalControl does, with the one
 * decision it exists for: Go, or not.
 *
 * Go sends the goal that was previewed, and the robot plans again as it sets
 * off — a person can step into the way between the two — which the footnote
 * says, so a route that comes out a little different is not a surprise. A
 * goal with no route offers only Discard: Go would fail with the same reason.
 * Presentation only.
 */
export function RoutePreviewControl({
  state,
  stale,
  goLocked,
  goLockReason = null,
  onGo,
  onAgain,
  className,
}: {
  state: RoutePreviewState;
  /** The robot has walked off the preview's start, so it is out of date. */
  stale: boolean;
  /** A goal is running or on its way, or the stop is engaged. */
  goLocked: boolean;
  /** Why Go is held, when the reason is not a running goal. */
  goLockReason?: string | null;
  onGo: () => void;
  onAgain: () => void;
  className?: string;
}) {
  const { goal, preview, pending, error } = state;
  if (!goal) return null;

  const reachable = preview?.reachable === true;

  return (
    <div
      className={cn(overlayPanel, "w-full p-2.5", className)}
      role="region"
      aria-label="Route preview"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="instrument-label text-muted-foreground">Route preview</span>
        {pending ? (
          <Chip tone="cmd">PLANNING</Chip>
        ) : stale && preview ? (
          <Chip tone="caution">OUT OF DATE</Chip>
        ) : preview && !reachable ? (
          <Chip tone="warn">NO ROUTE</Chip>
        ) : null}
      </div>

      <div className="space-y-1">
        <Readout label="Goal X" value={goal.x.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Goal Y" value={goal.y.toFixed(2)} unit="m" tone="cmd" />
        <Readout label="Orientation" value={goal.theta.toFixed(1)} unit="°" tone="cmd" />
        {reachable && (
          <Readout
            label="Route length"
            value={preview.length_m.toFixed(1)}
            unit="m"
            tone="cmd"
          />
        )}
      </div>

      {/* role=status so a screen reader hears the answer arrive. */}
      <div role="status">
        {preview && !reachable && (
          <p className="mt-2.5 text-[11px] leading-snug break-words text-signal-warn">
            {stepFailureText(preview.message)}
          </p>
        )}
        {error && (
          <p className="mt-2.5 text-[11px] leading-snug break-words text-signal-warn">
            {error}
          </p>
        )}
        {stale && preview && (
          <p className="mt-2.5 text-[11px] leading-snug text-signal-caution">
            The robot has moved since this route was planned.
          </p>
        )}
      </div>

      {reachable && !stale && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {goLockReason ?? "The robot plans again when it sets off."}
        </p>
      )}

      <div className="mt-2.5 flex gap-1.5">
        {stale && preview ? (
          <button
            type="button"
            disabled={pending}
            onClick={onAgain}
            className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd transition-colors hover:bg-signal-cmd/20 disabled:opacity-50"
          >
            <RefreshCwIcon className="size-3.5" />
            Preview again
          </button>
        ) : (
          <button
            type="button"
            disabled={!reachable || pending || goLocked}
            onClick={onGo}
            className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd transition-colors hover:bg-signal-cmd/20 disabled:opacity-50"
          >
            <SendIcon className="size-3.5" />
            Go
          </button>
        )}
        <button
          type="button"
          onClick={state.clear}
          className="instrument-label h-7 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
