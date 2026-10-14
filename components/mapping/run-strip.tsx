"use client";

import { PlayIcon, RotateCcwIcon, SaveIcon } from "lucide-react";

import { RecordDot, StripDivider, overlayPanel } from "@/components/console/instrument";
import type { RunFace } from "@/lib/map/run-face";
import { cn } from "@/lib/utils";

/** Which run write is in flight; the strip holds every button while one is. */
export type RunPending = "start" | "save" | "reset" | null;

/**
 * The run's controls as one strip over the viewport: Start while idle, then a
 * recording indicator beside Save and New map. One strip because the faces
 * are exclusive. Presentational: `face` comes from lib/map/run-face.ts, and
 * the page owns the confirm (`onReset`) and the name dialog (`onSave`).
 *
 * Worded buttons, since Start mapping is what the screen is for. Native
 * `<button>`s, because the shadcn Button sets `pointer-events-none` when
 * disabled and the held Start's `title` (why it is held) would never show.
 * The indicator borrows the recorder's red, so both capture surfaces agree.
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
          {/* A live region so a screen reader hears the state change; a run
            * shows the dot alone (by request), so the word is SR-only. */}
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
          {/* Warn-bordered, not solid: the red fills in the confirm it opens. */}
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

// The "Top down" button's family: caps label on a hairline, 24 px / 40 px
// under a finger. `disabled:hover:bg-transparent` rather than
// `pointer-events-none`, so the held Start still shows its title.
const BUTTON =
  "instrument-label flex h-6 items-center gap-1.5 rounded-sm border px-2 transition-colors pointer-coarse:min-h-10 disabled:opacity-40 disabled:hover:bg-transparent";
const CMD =
  "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd hover:bg-signal-cmd/20 disabled:hover:bg-signal-cmd/12";
const WARN =
  "border-signal-warn/50 text-signal-warn hover:bg-signal-warn/12";
