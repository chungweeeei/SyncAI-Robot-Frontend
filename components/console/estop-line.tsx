"use client";

import { OctagonXIcon, XIcon } from "lucide-react";

import { useConsoleEstop } from "@/hooks/use-console-estop";
import type { EstopLine as Line } from "@/lib/robot/estop";
import { cn } from "@/lib/utils";

const HEADLINE: Record<Line, string> = {
  refused: "Stop not confirmed.",
  "release-refused": "Release not confirmed.",
  releasing: "Releasing…",
  stopping: "Stopping…",
  stopped: "Emergency stop engaged.",
};

/** The sentence after the headline: what is true now and what to do about it. */
const DETAIL: Record<Line, string> = {
  refused: "The robot may still be moving. Press the stop again.",
  "release-refused": "The robot is still stopped.",
  releasing: "Waiting for the robot to confirm. It stays stopped until then.",
  stopping: "Waiting for the robot to confirm the lock.",
  stopped: "The robot's motion is locked. Hold the stop button for one second to release it.",
};

/**
 * The stop in words, as a band across the bottom of the masthead, on every
 * screen. The button beside it stays an icon; this is what a customer or a
 * PM reads from across the room, and the one place a refused press is said
 * where a finger can see it (a tooltip it cannot open was the only place
 * before).
 *
 * A refusal is an alert and stays until it is dismissed or the next press
 * replaces it — the backend's own sentence follows the headline, verbatim.
 * The states are a polite live region, replaced in place as the reading
 * moves, so a screen reader hears "Stopping…" become "engaged" without a
 * second band.
 * Collapsed to nothing while the robot is free to move.
 */
export function EstopLine() {
  const { line, notice, dismissNotice } = useConsoleEstop();
  const refusal = line === "refused" || line === "release-refused";

  return (
    <>
      {/* Kept mounted while empty: a live region added with its text is not
        * read. Not role=status — the job bar is the banner's one status. */}
      <div aria-live="polite">{line && !refusal && <Band line={line} />}</div>
      {/* An alert is read as it appears, so it mounts with its sentence. */}
      {line && refusal && (
        <div role="alert">
          <Band line={line} notice={notice} onDismiss={dismissNotice} />
        </div>
      )}
    </>
  );
}

function Band({
  line,
  notice,
  onDismiss,
}: {
  line: Line;
  notice?: string | null;
  onDismiss?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 border-t border-signal-warn/30 bg-signal-warn/10 py-1.5 text-[13px] leading-snug",
        "pr-[max(0.625rem,env(safe-area-inset-right))] pl-[max(0.625rem,env(safe-area-inset-left))] sm:pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1rem,env(safe-area-inset-left))]",
      )}
    >
      <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-signal-warn" />
      <p className="min-w-0 flex-1 break-words">
        <span className="font-medium text-signal-warn">{HEADLINE[line]}</span>{" "}
        {notice && <span>{notice} </span>}
        <span className="text-foreground">{DETAIL[line]}</span>
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="-my-1 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-signal-warn/15 hover:text-foreground pointer-coarse:-my-2.5 pointer-coarse:size-10"
        >
          <XIcon aria-hidden className="size-4" />
        </button>
      )}
    </div>
  );
}
