"use client";

import { PlayIcon, RotateCcwIcon, SaveIcon } from "lucide-react";

import { RecordDot, StripDivider, overlayPanel } from "@/components/console/instrument";
import type { RunFace } from "@/lib/map/run-face";
import { cn } from "@/lib/utils";

/** Which run write is in flight; the strip holds every button while one is. */
export type RunPending = "start" | "save" | "reset" | null;

/**
 * The run's controls, as one strip over the viewport: Start while nothing is
 * running, and once a run is on, a recording indicator beside Save and New
 * map.
 *
 * It replaced three groups in the rail (2026-10), by request: the run is what
 * this screen is for, and its buttons belong on the picture they act on, the
 * way the dashboard's pose tools sit over the map they aim at. One strip
 * rather than three because the faces are exclusive — the robot is idle, or
 * building, or between the two — and a Start button greyed under a running
 * indicator would be the rail's old shape in a smaller box.
 *
 * Worded buttons, not the ToolStrip's icons: Start mapping is the one press
 * this screen exists for and its name should not live in a tooltip. Native
 * `<button>`s rather than the shadcn Button, because that one sets
 * `pointer-events-none` on a disabled control and the held Start's `title` —
 * the sentence saying why it is held — would never show. The indicator is
 * record-red, borrowed from the recorder: two capture surfaces disagreeing
 * about what "running" looks like would be worse than one borrowed hue.
 *
 * Presentational. `face` is the rule in lib/map/run-face.ts, read off the
 * robot's own run state; New map goes out through `onReset` because the page
 * owns the confirm that may stop it, and Save through `onSave` because the
 * name is asked for in a dialog the page keeps.
 */
export function RunStrip({
  face,
  pending,
  onStart,
  onSave,
  onReset,
  className,
}: {
  face: RunFace;
  pending: RunPending;
  onStart: () => void;
  onSave: () => void;
  onReset: () => void;
  className?: string;
}) {
  const held = pending !== null;

  return (
    <div
      role="group"
      aria-label="Mapping run"
      className={cn(overlayPanel, "flex items-center gap-1 p-1", className)}
    >
      {face.kind === "start" ? (
        <button
          type="button"
          disabled={!face.enabled || held}
          title={face.reason ?? undefined}
          onClick={onStart}
          className={cn(BUTTON, CMD)}
        >
          <PlayIcon aria-hidden className="size-3.5" />
          {pending === "start" ? "Starting…" : "Start mapping"}
        </button>
      ) : (
        <>
          {/* A live region: the state word changes on a start, a save and a
            * reset, which a screen reader should hear the way a sighted
            * operator sees the dot start to pulse. A run shows the dot alone,
            * by request, so its word is for the screen reader only. */}
          <span
            role="status"
            className={cn(
              "instrument-label flex h-6 items-center gap-1.5 px-2",
              face.kind === "run" ? "text-signal-warn" : "text-signal-caution",
            )}
          >
            {face.kind === "run" ? (
              <>
                <RecordDot />
                <span className="sr-only">Mapping</span>
              </>
            ) : (
              face.readout
            )}
          </span>

          <StripDivider />

          <button
            type="button"
            disabled={face.kind !== "run" || held}
            onClick={onSave}
            className={cn(BUTTON, CMD)}
          >
            <SaveIcon aria-hidden className="size-3.5" />
            {pending === "save" ? "Saving…" : "Save"}
          </button>
          {/* Warn-bordered, not solid: the red is spent on the one press that
            * loses the run, and the confirm it opens is where the red fills. */}
          <button
            type="button"
            disabled={face.kind !== "run" || held}
            onClick={onReset}
            className={cn(BUTTON, WARN)}
          >
            <RotateCcwIcon aria-hidden className="size-3.5" />
            {pending === "reset" ? "Resetting…" : "New map"}
          </button>
        </>
      )}
    </div>
  );
}

// The "Top down" button's family, from the bottom-left of the same viewport:
// a caps label on a hairline, 24 px under a mouse and 40 px under a finger.
// `disabled:hover:bg-transparent` rather than `pointer-events-none`, so the
// held Start still takes the hover that shows its title.
const BUTTON =
  "instrument-label flex h-6 items-center gap-1.5 rounded-sm border px-2 transition-colors pointer-coarse:min-h-10 disabled:opacity-40 disabled:hover:bg-transparent";
const CMD =
  "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd hover:bg-signal-cmd/20 disabled:hover:bg-signal-cmd/12";
const WARN =
  "border-signal-warn/50 text-signal-warn hover:bg-signal-warn/12";
