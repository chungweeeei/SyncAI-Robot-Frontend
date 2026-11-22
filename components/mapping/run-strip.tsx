"use client";

import { MapPlusIcon, PlayIcon, RotateCcwIcon, SaveIcon } from "lucide-react";

import { RecordDot, StripDivider, overlayPanel } from "@/components/console/instrument";
import { RESUME_NEEDS_MAPPING_MODE, type RunFace } from "@/lib/map/run-face";
import { cn } from "@/lib/utils";

/** Which run write is in flight; the strip holds every button while one is. */
export type RunPending = "start" | "resume" | "save" | "reset" | null;

/**
 * The run's controls as one strip over the viewport: Start and Resume
 * while idle, then a recording indicator beside Save and New map. One strip
 * because the faces are exclusive. Presentational: `face` comes from
 * lib/map/run-face.ts, and the page owns the confirm (`onReset`) and the
 * dialogs (`onResume`, `onSave`).
 *
 * Resume sits beside Start because it is the same moment: both begin a
 * run, and the robot takes either only in Mapping with no run on, which is
 * the one face that offers them.
 *
 * New map belongs to a run started from nothing. On a resumed run it is not
 * offered: a reset there does not go back to the saved map, it starts an
 * empty one, which is neither what "New map" promises beside a map's name
 * nor a way to try the resume again. Leaving a resumed run unsaved is the
 * mode switch's question.
 *
 * Worded buttons, since starting a run is what the screen is for; one word
 * each, the group's name ("Mapping run") saying what of. Native
 * `<button>`s, because the shadcn Button sets `pointer-events-none` when
 * disabled and the held Start's `title` (why it is held) would never show.
 * The indicator borrows the recorder's red, so both capture surfaces agree.
 */
export function RunStrip({
  face,
  pending,
  resumedFrom,
  onStart,
  onResume,
  onSave,
  onReset,
  className,
}: {
  face: RunFace;
  pending: RunPending;
  /**
   * The saved map this run continues, when this console resumed it — the
   * robot's status does not say, so another console's resume shows the dot
   * alone, and New map with it.
   */
  resumedFrom: string | null;
  onStart: () => void;
  onResume: () => void;
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
        <>
          <button
            type="button"
            disabled={!face.enabled || held}
            title={face.reason ?? undefined}
            onClick={onStart}
            className={cn(BUTTON, CMD)}
          >
            <PlayIcon aria-hidden className="size-3.5" />
            {pending === "start" ? "Starting…" : "Start"}
          </button>
          {/* Hairlined, not filled: Start is what the screen is for, and this
            * opens a dialog rather than commanding. */}
          <button
            type="button"
            disabled={!face.enabled || held}
            title={face.enabled ? undefined : RESUME_NEEDS_MAPPING_MODE}
            onClick={onResume}
            className={cn(BUTTON, QUIET)}
          >
            <MapPlusIcon aria-hidden className="size-3.5" />
            {pending === "resume" ? "Resuming…" : "Resume"}
          </button>
        </>
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
                {/* The one word a resumed run adds: which map it is adding
                  * to. Not uppercased — it is a name someone typed. */}
                {resumedFrom !== null && (
                  <span
                    title={`Continuing ${resumedFrom}`}
                    className="readout max-w-28 truncate text-[11px] tracking-normal text-muted-foreground normal-case"
                  >
                    <span className="sr-only">, continuing </span>
                    {resumedFrom}
                  </span>
                )}
              </>
            ) : // This console's own resume: the robot says only that it is busy.
            pending === "resume" ? (
              "Resuming…"
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
          {/* Warn-bordered, not solid: the red fills in the confirm it opens.
            * Absent, not greyed, on a resumed run: there is nothing to wait for. */}
          {resumedFrom === null && (
            <button
              type="button"
              disabled={face.kind !== "run" || held}
              onClick={onReset}
              className={cn(BUTTON, WARN)}
            >
              <RotateCcwIcon aria-hidden className="size-3.5" />
              {pending === "reset" ? "Resetting…" : "New map"}
            </button>
          )}
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
const QUIET =
  "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground disabled:hover:text-muted-foreground";
const WARN =
  "border-signal-warn/50 text-signal-warn hover:bg-signal-warn/12";
