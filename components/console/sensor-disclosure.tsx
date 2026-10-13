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
 * The masthead's sensor button, where an overheating motor interrupts on
 * every screen, beside the drive panel the operator should stop using.
 *
 * The rule is `nextHeatAlertPhase` (lib/robot/heat-alert.ts). A raised notice
 * drops on its own; dismissing it leaves the dot until the motor cools, so a
 * still-hot joint never looks fine. A press while dismissed only reopens it to
 * read (`peek`).
 *
 * The phase is derived during render (an effect would be the setState the
 * compiler lint rejects) and lives in the layout, so a dismissal survives
 * navigation.
 */
export function SensorDisclosure() {
  const { state } = useConsoleRobotState();
  const hottest = state ? hottestMotor(state.motor_status) : undefined;
  const [phase, setPhase] = React.useState<HeatAlertPhase>("clear");
  const [peek, setPeek] = React.useState(false);

  // Settles in one extra render: an unchanged reading returns the same phase.
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
          // Announced only when it drops on its own, not when reopened.
          role={next === "raised" ? "alert" : undefined}
          className={cn(
            overlayPanel,
            droppedPanel,
            // Warn on the left rule and the words only: a red wash is
            // unreadable in one of the themes.
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

          {/* The motor grid's label, so the joint can be found on the dashboard. */}
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
        // Still answers the press: opening nothing reads as broken.
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
