"use client";

import { CheckIcon } from "lucide-react";

import { Chip, overlayPanel } from "@/components/console/instrument";
import { cardAction } from "@/components/dashboard/overlay-card";
import type { RobotStateControl } from "@/hooks/use-robot-state-control";
import {
  STATE_SILENT,
  STATE_SILENT_HOLD,
  STATE_SILENT_LABEL,
  robotStatusView,
} from "@/lib/robot/readiness";
import { cn } from "@/lib/utils";

/**
 * Confirm position, on the dashboard: shown while nobody has confirmed where
 * the robot is, in Navigation mode. It is here as well as on the masthead
 * because this is where the judgement is made — the live scan against the
 * map — and a panel rather than a button on the toolbar, which is sized to
 * one phone row. It is also where the goal tools' hold is said, since Set
 * goal, Go and Charge are greyed with it.
 *
 * The robot having found its position only lets the button be pressed; that
 * the position is right is what the operator confirms, so the panel asks
 * for the check in words — few of them: on a phone the viewport is half the
 * screen (the dashboard puts the pose card away there while this is up, as
 * it covered the button). Once confirmed the panel goes: the masthead's chip
 * is the reading. Presentation only (`useRobotStateControl`).
 *
 * If the robot stops reporting its state while the panel is up, the panel
 * stays — one that vanished would take the button from under a finger — but
 * says so in the chip's words and holds Confirm: a position cannot be
 * confirmed on a state nobody is reading, and the robot would refuse it.
 */
export function ConfirmPositionControl({
  control,
  className,
}: {
  control: RobotStateControl;
  className?: string;
}) {
  const { state, message, action, busy, error, apply } = control;
  if (control.confirmPanel === "silent") {
    return <SilentPanel silence={control.silence} className={className} />;
  }
  const confirm = action?.id === "confirm" ? action : null;
  if (control.confirmPanel !== "live" || state === null || !confirm) return null;
  const view = robotStatusView(state);

  return (
    <section
      aria-label="Robot position"
      className={cn(overlayPanel, "w-full p-2.5", className)}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="instrument-label text-muted-foreground">Position</h2>
        <Chip tone={view.tone}>{view.label}</Chip>
      </div>

      {/* role=status so the reason is heard when the panel appears with it. */}
      <div role="status" className="mt-2.5 space-y-1.5 text-[11px] leading-snug break-words">
        {/* The robot's own sentence, verbatim, when it has one. */}
        {message && <p>{message}</p>}
        <p className="text-muted-foreground">
          Check the live scan against the map, then confirm. Set goal, Go and Charge open
          once you do.
        </p>
        {confirm.lock && <p className="text-signal-caution">{confirm.lock}</p>}
        {error && <p className="text-signal-warn">{error}</p>}
      </div>

      <div className="mt-2.5 flex gap-1.5">
        <button
          type="button"
          disabled={busy || confirm.lock !== null}
          onClick={() => apply(confirm.target)}
          className={cardAction("cmd")}
        >
          <CheckIcon className="size-3.5" aria-hidden />
          {confirm.label}
        </button>
      </div>
    </section>
  );
}

/** The panel while the robot is not reporting: the chip's dash, its words, Confirm held. */
function SilentPanel({ silence, className }: { silence: string | null; className?: string }) {
  return (
    <section aria-label="Robot position" className={cn(overlayPanel, "w-full p-2.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="instrument-label text-muted-foreground">Position</h2>
        <Chip tone="neutral">{STATE_SILENT_LABEL}</Chip>
      </div>
      <div role="status" className="mt-2.5 space-y-1.5 text-[11px] leading-snug break-words">
        <p>{silence ?? STATE_SILENT}</p>
        <p className="text-signal-caution">{STATE_SILENT_HOLD}</p>
      </div>
      <div className="mt-2.5 flex gap-1.5">
        <button type="button" disabled className={cardAction("cmd")}>
          <CheckIcon className="size-3.5" aria-hidden />
          Confirm position
        </button>
      </div>
    </section>
  );
}
