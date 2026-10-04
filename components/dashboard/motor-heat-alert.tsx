"use client";

import * as React from "react";
import { XIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import {
  type HeatAlertPhase,
  hottestMotor,
  nextHeatAlertPhase,
} from "@/lib/robot/heat-alert";
import { motorLabel } from "@/lib/robot/motor-label";
import type { RobotMotorStatus } from "@/lib/types/robot";
import { cn } from "@/lib/utils";

/**
 * The one thing on the dashboard that interrupts: a motor over the alert
 * limit (lib/robot/levels.ts's TEMP_ALERT_C, 85 °C).
 *
 * The motor grid already turns a hot joint red, but the grid is the last
 * group on a rail the operator consults rather than watches, and below `lg`
 * it is under the fold entirely. The viewport is where the eyes are, so the
 * notice lands there — the bottom-left corner, which no toolbar or read-back
 * uses, leaving bottom-right free for a parked drive panel the way the
 * viewport's own comment asks.
 *
 * In place, not a toast, and with no timer: the editor's save notes say why
 * nothing that matters auto-dismisses here. It stays until the operator
 * closes it or the motor has cooled, and a closed notice does not come back
 * until the motor has cooled and crossed the limit again — the rule, with
 * its hysteresis, is `nextHeatAlertPhase`. The phase is adjusted during
 * render from the reading in the props rather than in an effect: the
 * reading arrives as a render already, and a setState in an effect for a
 * value derived from props is the pattern the compiler lint rejects.
 */
export function MotorHeatAlert({
  motors,
  className,
}: {
  motors: readonly RobotMotorStatus[];
  className?: string;
}) {
  const hottest = hottestMotor(motors);
  const [phase, setPhase] = React.useState<HeatAlertPhase>("clear");

  // Settles in one extra render: the rule hands back the same phase for a
  // reading that changes nothing, which is what stops this from looping.
  const next = nextHeatAlertPhase(phase, hottest?.temperature);
  if (next !== phase) setPhase(next);

  if (next !== "raised" || !hottest) return null;

  return (
    <div
      role="alert"
      className={cn(
        overlayPanel,
        // The warn hue is spent on the rule down the left edge and the words;
        // the panel itself stays the console's, because a red wash over a
        // canvas that can be any colour is unreadable in at least one theme.
        "w-64 max-w-full border-l-2 border-l-signal-warn border-signal-warn/40 px-3 py-2.5",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="instrument-label text-signal-warn">A motor is overheating</p>
        <button
          type="button"
          onClick={() => setPhase("dismissed")}
          aria-label="Dismiss"
          className="-mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors pointer-coarse:size-10 hover:bg-elevated hover:text-foreground"
        >
          <XIcon aria-hidden className="size-3.5" />
        </button>
      </div>

      {/* The grid's own label for the joint, so the operator can find it in
        * the motor group by the same two codes, and the number in the readout
        * face at the pose's size: it is the fact the notice exists for. */}
      <p className="mt-1.5 flex items-baseline gap-2">
        <span className="instrument-label text-muted-foreground">
          {motorLabel(hottest.name)}
        </span>
        <span className="readout text-2xl leading-none font-medium text-signal-warn">
          {hottest.temperature}
          <span className="ml-0.5 text-xs font-normal text-muted-foreground">
            °
          </span>
        </span>
      </p>

      <p className="mt-2 text-[11px] leading-snug text-foreground">
        Stop driving and let the robot cool down before continuing.
      </p>
    </div>
  );
}
