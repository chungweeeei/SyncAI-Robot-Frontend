"use client";

import * as React from "react";
import { ActivityIcon, ThermometerIcon, XIcon } from "lucide-react";

import { TONE_TEXT } from "@/components/console/instrument";
import {
  StripDisclosure,
  droppedPanel,
} from "@/components/console/strip-disclosure";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import {
  type HeatAlertPhase,
  heatGaugeFraction,
  hottestMotor,
  nextHeatAlertPhase,
} from "@/lib/robot/heat-alert";
import { TEMP_ALERT_C, motorTempTone } from "@/lib/robot/levels";
import type { Tone } from "@/lib/types/tone";
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
 * Drawn as the robot state's card is: a tinted icon tile beside a title and
 * a line, then the reading — the hottest joint's number large, on a gauge
 * with the notice's limit marked, so how far past it (or how far under) is
 * seen and not computed. Nothing under it: the title and the number say it
 * (the closing lines were dropped by request).
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
      <div
        // Announced only when it drops on its own, not when reopened.
        role={hot && next === "raised" ? "alert" : undefined}
        aria-label="Sensor alerts"
        className={cn(
          droppedPanel,
          "w-72 max-w-[calc(100vw-1.5rem)] space-y-3 rounded-md border bg-panel p-3 text-foreground shadow-md",
          // Warn on the frame, the tile and the words only: a red wash is
          // unreadable in one of the themes.
          hot ? "border-signal-warn/45" : "border-hairline",
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={cn(
              "grid size-7 shrink-0 place-items-center rounded-sm",
              hot ? "bg-signal-warn/12 text-signal-warn" : "bg-muted text-muted-foreground",
            )}
          >
            <ThermometerIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p
              className={cn(
                "text-[14px] leading-7 font-semibold",
                hot ? "text-signal-warn" : "text-foreground",
              )}
            >
              {hot ? "A motor is overheating" : "Sensor alerts"}
            </p>
            {!hot && (
              <p className="text-[12px] leading-snug text-muted-foreground">
                {hottest ? "All motors are within limits." : "No motor readings yet."}
              </p>
            )}
          </div>
          {hot && (
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Dismiss"
              className="-mt-0.5 -mr-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors pointer-coarse:size-10 hover:bg-elevated hover:text-foreground"
            >
              <XIcon aria-hidden className="size-4" />
            </button>
          )}
        </div>

        {hottest && <HeatReading name={hottest.name} celsius={hottest.temperature} hot={hot} />}
      </div>
    </StripDisclosure>
  );
}

const FILL: Record<Tone, string> = {
  neutral: "bg-muted-foreground/60",
  live: "bg-signal-live",
  cmd: "bg-signal-cmd",
  active: "bg-signal-active",
  caution: "bg-signal-caution",
  warn: "bg-signal-warn",
};

/**
 * The hottest joint: its name (the motor grid's, so it can be found on the
 * dashboard), its number, and a gauge with the notice's limit marked. The
 * number is large when it is the alarm and readout-sized when it is a
 * glance.
 */
function HeatReading({ name, celsius, hot }: { name: string; celsius: number; hot: boolean }) {
  const tone = motorTempTone(celsius);
  return (
    <div className="rounded-sm border border-hairline bg-elevated/40 px-2.5 py-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {/* Its own element: the grid's word, which a test finds exactly. */}
          <p className="truncate text-[13px] font-medium text-foreground">{motorLabel(name)}</p>
        </div>
        <p
          className={cn(
            "readout shrink-0 leading-none font-medium tabular-nums",
            hot ? "text-[28px]" : "text-[18px]",
            TONE_TEXT[tone],
          )}
        >
          {celsius}
          <span className="ml-0.5 text-[12px] font-normal text-muted-foreground">°C</span>
        </p>
      </div>
      <div className="relative mt-2.5 h-1.5 rounded-full bg-muted" aria-hidden>
        <div
          className={cn("h-full rounded-full", FILL[tone])}
          style={{ width: `${heatGaugeFraction(celsius) * 100}%` }}
        />
        {/* In the ink, not red: past the limit the fill is red under it. */}
        <span
          className="absolute -top-1 h-3.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/70"
          style={{ left: `${heatGaugeFraction(TEMP_ALERT_C) * 100}%` }}
        />
      </div>
      <p className="mt-1 text-right text-[10px] text-muted-foreground tabular-nums">
        Limit {TEMP_ALERT_C}°C
      </p>
    </div>
  );
}
