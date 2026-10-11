"use client";

import { RadarIcon } from "lucide-react";

import { Chip, Readout, overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import type { AutoLocalize } from "@/hooks/use-auto-localize";

/**
 * Read-back for Auto localize: the robot searching, where it found itself, or
 * why it could not. Pressing it is the viewport toolbar's Auto localize.
 *
 * In the caution hue, like the initial pose read-back above it, for the same
 * reason: both override the robot's own idea of where it is, which is the
 * quieter and worse kind of mistake than a goal sent to the wrong place.
 *
 * "Localized", not "Sent", unlike its neighbour: this request is held until
 * the robot has matched its surroundings against the map and settled there,
 * so a success is the reading, not a request still waiting on one.
 *
 * Presentation only; everything lives in `useAutoLocalize`.
 */
export function AutoLocalizeControl({
  localize,
  className,
}: {
  localize: AutoLocalize;
  className?: string;
}) {
  const { result, busy, error } = localize;

  if (!busy && !result && !error) return null;

  return (
    <div
      role="status"
      aria-label="Auto localize"
      className={cn(overlayPanel, "w-full p-2.5", className)}
    >
      {result && (
        <div className="space-y-1">
          <Readout label="X" value={result.x.toFixed(2)} unit="m" tone="caution" />
          <Readout label="Y" value={result.y.toFixed(2)} unit="m" tone="caution" />
          <Readout
            label="Orientation"
            value={result.theta.toFixed(1)}
            unit="°"
            tone="caution"
          />
          <Readout
            label="Match"
            value={(result.inlier_ratio * 100).toFixed(0)}
            unit="%"
            tone="caution"
          />
        </div>
      )}

      <div
        className={cn("flex items-center justify-between gap-2", result && "mt-2.5")}
      >
        <span className="instrument-label text-muted-foreground">Auto localize</span>
        {busy ? (
          <Chip tone="caution">Searching</Chip>
        ) : error ? (
          <Chip tone="warn">Failed</Chip>
        ) : (
          <Chip tone="live">Localized</Chip>
        )}
      </div>

      {/* The search can take a quarter of a minute, and a pulsing icon alone
        * reads as hung long before then. */}
      {busy && (
        <p className="mt-2.5 text-[11px] leading-snug text-muted-foreground">
          Matching the surroundings against the map — up to 15 s.
        </p>
      )}

      {error && (
        <p className="mt-2.5 text-[11px] leading-snug break-words text-signal-warn">
          {error}
        </p>
      )}

      {!busy && (
        <div className="mt-2.5 flex gap-1.5">
          {/* Only after a failure: a match that held has nothing to retry,
            * and the toolbar button is there for a deliberate second search. */}
          {error && (
            <button
              type="button"
              disabled={localize.lock !== null}
              title={localize.lock ?? undefined}
              onClick={localize.run}
              className="instrument-label flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-signal-caution/50 bg-signal-caution/12 text-signal-caution transition-colors hover:bg-signal-caution/20 disabled:opacity-50"
            >
              <RadarIcon className="size-3.5" />
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={localize.clear}
            className="instrument-label h-7 rounded-sm border border-hairline px-2 text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
