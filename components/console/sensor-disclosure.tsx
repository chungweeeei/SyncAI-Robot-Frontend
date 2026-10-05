"use client";

import * as React from "react";
import { ActivityIcon, XIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import {
  StripDisclosure,
  droppedPanel,
} from "@/components/console/strip-disclosure";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import {
  type HeatAlertPhase,
  hottestMotor,
  nextHeatAlertPhase,
} from "@/lib/robot/heat-alert";
import { motorLabel } from "@/lib/robot/motor-label";
import { cn } from "@/lib/utils";

/**
 * The masthead's sensor button, and where an overheating motor interrupts.
 *
 * The notice used to sit in the dashboard viewport's bottom-left corner, which
 * only an operator on `/` ever saw: a motor running hot while someone edited a
 * floor plan or a job said nothing until they went back. The strip is on every
 * screen, so the notice hangs off it now, by request — next to the drive
 * panel, which is the thing an operator should stop using when it fires.
 *
 * The rule is unchanged and lives in `nextHeatAlertPhase` (lib/robot/
 * heat-alert.ts): raised above TEMP_ALERT_C, cleared — and re-armed — only
 * under TEMP_WARN_C. What the strip adds is the dot. A raised notice drops on
 * its own; dismissing it closes the panel but leaves the dot until the motor
 * has cooled, because a closed notice about a joint that is still hot should
 * not look like a robot that is fine. A press while dismissed only reopens it
 * to read (`peek`), without re-raising it.
 *
 * The phase is adjusted during render from the reading rather than in an
 * effect: the reading arrives as a render already, and a setState in an effect
 * for a value derived from it is the pattern the compiler lint rejects. It
 * lives here, in the layout, so it survives a navigation — a notice dismissed
 * on one screen stays dismissed on the next.
 */
export function SensorDisclosure() {
  const { state } = useConsoleRobotState();
  const hottest = state ? hottestMotor(state.motor_status) : undefined;
  const [phase, setPhase] = React.useState<HeatAlertPhase>("clear");
  const [peek, setPeek] = React.useState(false);

  // Settles in one extra render: the rule hands back the same phase for a
  // reading that changes nothing, which is what stops this from looping. A
  // motor that has cooled also takes a panel opened to read it with it.
  const next = nextHeatAlertPhase(phase, hottest?.temperature);
  if (next !== phase) {
    setPhase(next);
    if (next === "clear") setPeek(false);
  }

  const hot = next !== "clear" && hottest !== undefined;
  const open = next === "raised" || peek;
  const onOpenChange = (wanted: boolean) => {
    if (!wanted && next === "raised") setPhase("dismissed");
    setPeek(wanted);
  };

  return (
    <StripDisclosure
      icon={ActivityIcon}
      label={hot ? "Sensor alerts: a motor is overheating" : "Sensor alerts"}
      showTitle={hot ? "A motor is overheating" : "Show sensor alerts"}
      hideTitle="Hide sensor alerts"
      open={open}
      onOpenChange={onOpenChange}
      alert={hot}
    >
      {hot ? (
        <div
          // Announced only when it drops on its own; reopened to read, it is
          // something the operator asked for, not news.
          role={next === "raised" ? "alert" : undefined}
          className={cn(
            overlayPanel,
            droppedPanel,
            // The warn hue is spent on the rule down the left edge and the
            // words; the panel itself stays the console's, because a red wash
            // is unreadable over whatever page it lands on in one theme.
            "w-64 max-w-[calc(100vw-1.5rem)] border-l-2 border-l-signal-warn border-signal-warn/40 px-3 py-2.5",
          )}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="instrument-label text-signal-warn">A motor is overheating</p>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Dismiss"
              className="-mr-1.5 flex size-6 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors pointer-coarse:size-10 hover:bg-elevated hover:text-foreground"
            >
              <XIcon aria-hidden className="size-3.5" />
            </button>
          </div>

          {/* The motor grid's own label for the joint, so the operator can
            * find it on the dashboard by the same two codes, and the number in
            * the readout face: it is the fact the notice exists for. */}
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
      ) : (
        // Nothing to report still answers the press: a button that opens
        // nothing reads as a broken one.
        <div
          className={cn(
            overlayPanel,
            droppedPanel,
            "w-64 max-w-[calc(100vw-1.5rem)] px-3 py-2.5",
          )}
        >
          <p className="instrument-label text-muted-foreground">Sensor alerts</p>
          <p className="mt-1.5 text-[12px] leading-snug text-foreground">
            {hottest
              ? "All motors are within limits."
              : "No motor readings yet."}
          </p>
          {hottest && (
            <p className="mt-1 flex items-baseline gap-2">
              <span className="instrument-label text-muted-foreground">
                Hottest · {motorLabel(hottest.name)}
              </span>
              <span className="readout text-[13px]">
                {hottest.temperature}
                <span className="ml-0.5 text-[11px] text-muted-foreground">°</span>
              </span>
            </p>
          )}
        </div>
      )}
    </StripDisclosure>
  );
}
