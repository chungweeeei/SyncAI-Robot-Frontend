"use client";

import Link from "next/link";
import * as React from "react";

import { ActiveRunControls } from "@/components/console/active-run-controls";
import { CameraDisclosure } from "@/components/console/camera-disclosure";
import { DriveDisclosure } from "@/components/console/drive-disclosure";
import { EstopButton } from "@/components/console/estop-button";
import { SensorDisclosure } from "@/components/console/sensor-disclosure";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { useActiveMap, useMaps } from "@/hooks/use-maps";
import { batteryTone } from "@/lib/robot/levels";
import {
  Chip,
  SegmentMeter,
  StripDivider,
  type Tone,
} from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import type { RobotMode } from "@/lib/types/robot";

/** The robot's own mode names, in the words the mode switch uses for them. */
const MODE_LABEL: Record<RobotMode, string> = {
  AUTO: "Navigation",
  MANUAL: "Mapping",
  MAINTENANCE: "Maintenance",
};

const MODE_TONE: Record<RobotMode, Tone> = {
  AUTO: "live",
  MANUAL: "caution",
  MAINTENANCE: "warn",
};

/**
 * The console's masthead, on every screen: robot, mode, map, the running job,
 * and whether the link is alive. Before the first frame it holds its shape
 * with dashes. No page title: the rail already marks where you are.
 *
 * The bottom edge is the heartbeat: a sweep per 1 Hz robot-state frame, amber
 * when one does not arrive. It is the one animation in the console, because a
 * dead link invalidates everything else on screen. Under reduced motion it is
 * a static edge and the link chip says it in text.
 */
export function StatusStrip() {
  const { state, status, updatedAt } = useConsoleRobotState();
  const { engaged: stopped } = useConsoleEstop();
  const { map: activeMap } = useActiveMap();
  const { refresh: refreshMaps } = useMaps();

  // The map name comes from the catalogue, since `state.map` is a file path.
  // The catalogue is not polled, so a change in `state.map` (a switch from
  // another console) is what triggers a re-read. The first report only primes
  // the ref; the catalogue is already read on mount.
  const reportedMap = state?.map;
  const lastReportedMap = React.useRef(reportedMap);
  React.useEffect(() => {
    if (reportedMap === undefined || reportedMap === lastReportedMap.current) return;
    const first = lastReportedMap.current === undefined;
    lastReportedMap.current = reportedMap;
    if (!first) refreshMaps();
  }, [reportedMap, refreshMaps]);

  /**
   * Null while healthy, where the heartbeat already says it. The chip names
   * the faults, which under reduced motion only text can do.
   */
  const link: { label: string; tone: Tone } | null =
    status === "ok"
      ? null
      : status === "loading"
        ? { label: "Linking", tone: "neutral" }
        : state
          ? { label: "Last seen", tone: "caution" }
          : { label: "No signal", tone: "warn" };

  const battery = state?.battery_status.battery_percentage;

  return (
    <header className="relative shrink-0 bg-panel">
      {/* One wrapping row: below `sm` the job block wraps onto its own line
        * (`w-full order-last`). Wrapping rather than a second copy, which
        * would put two Pause buttons in the accessibility tree. */}
      <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-0 px-2.5 sm:flex-nowrap sm:gap-x-3.5 sm:px-4">
        {/* The one cluster that shrinks, the robot id the one thing that
          * truncates. `basis-0 grow` below `sm` because a wrapping row breaks
          * before it shrinks, which would push the health cluster onto a
          * third line. */}
        <div className="flex min-w-0 shrink items-center gap-1.5 max-sm:grow max-sm:basis-0 sm:gap-3.5">
          {/* The robot's name is the link home, like a site's logo. */}
          <Link
            href="/"
            className="readout truncate rounded-sm text-[15px] font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {state?.robot_id ?? "—"}
          </Link>
          {/* Mapping vs Navigation changes what every screen means, so it is
            * shown here; it is changed on the mapping screen. */}
          {state && <ModeChip mode={state.mode} />}
        </div>

        <StripDivider className="hidden sm:block" />

        <div className="hidden min-w-0 items-baseline gap-2 sm:flex">
          <span className="instrument-label text-muted-foreground">Map</span>
          <span className="readout truncate text-[13px]">
            {activeMap?.name ?? "—"}
          </span>
        </div>

        {/* The running job, read from the backend so it is true for a run
          * another console or a schedule started.
          *
          * `basis-[32rem]` (the full id, step and state) with an auto margin
          * rather than `flex-1`, so the bar does not stretch across a wide
          * screen and ends flush against the health cluster. The row's only
          * auto margin — a second would halve the gap. */}
        <div className="order-last -mx-2.5 flex w-full min-w-0 items-center gap-2 border-t border-hairline px-2.5 py-1.5 sm:order-none sm:mx-0 sm:ml-auto sm:w-auto sm:basis-[32rem] sm:border-0 sm:px-0 sm:py-0">
          <ActiveRunControls />
        </div>

        {/* Below `sm` it drops its rules and the battery meter (the figure
          * stays), by request: at full width it left the robot id ~14 px on
          * a 375 px phone. The e2e phone test holds the id whole. */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3.5">
          <StripDivider className="hidden sm:block" />
          {/* A 2 px gap keeps two hover-lit frames from merging into one. */}
          <div className="flex items-center gap-0.5">
            {/* The stop first, by request, in a cluster that never shrinks or
              * wraps, so it is in the same place at every width. Sensor next
              * to the drive panel it tells the operator to stop using. */}
            <EstopButton />
            <SensorDisclosure />
            <DriveDisclosure />
            <CameraDisclosure />
            {link && (
              // Framed on hover only, like the buttons beside it.
              <Chip
                tone={link.tone}
                className="border-transparent hover:border-current/40"
              >
                {link.label}
              </Chip>
            )}
            {/* No Wi-Fi bars, by request: they live on the dashboard and in
              * Settings beside their network. */}
          </div>

          <StripDivider className="hidden sm:block" />

          {/* No "Batt" label: the meter and the % sign already say it. */}
          <div className="flex items-center gap-2">
            {battery === undefined ? (
              <span className="readout text-[13px] text-muted-foreground">—</span>
            ) : (
              <>
                <SegmentMeter
                  value={battery}
                  tone={batteryTone(battery)}
                  className="hidden sm:flex"
                />
                <span
                  className={cn(
                    "readout text-[13px] font-medium",
                    batteryTone(battery) === "warn" && "text-signal-warn",
                    batteryTone(battery) === "caution" && "text-signal-caution",
                  )}
                >
                  {battery}
                  <span className="ml-0.5 text-[11px] text-muted-foreground">
                    %
                  </span>
                </span>
              </>
            )}
          </div>

          {/* No clock, by request: the heartbeat is the freshness reading. */}
        </div>
      </div>

      {/* The strip's bottom edge is the heartbeat, so it replaces the border. */}
      <div
        aria-hidden
        className={cn(
          "relative h-px w-full overflow-hidden",
          // An engaged stop outranks the link: solid, with no sweep, since a
          // green pulse over it would read as all-clear.
          stopped
            ? "h-0.5 bg-signal-warn"
            : status !== "error"
            ? "bg-hairline"
            : state
              ? "bg-signal-caution/50"
              : "bg-signal-warn/50",
        )}
      >
        {status === "ok" && !stopped && (
          // Remounted on every frame (`key`) so the 1 s traverse restarts in
          // step with the arrival rather than free-running out of phase.
          <span
            key={updatedAt ?? 0}
            className="strip-sweep absolute inset-y-0 left-0 w-1/3 bg-gradient-to-r from-transparent via-signal-live to-transparent"
          />
        )}
      </div>
    </header>
  );
}

/**
 * The robot's mode; a dot in the mode's hue below `sm`, where the word would
 * truncate the robot id. The word stays in the accessible name and the title.
 * One element styled two ways, so it is in the accessibility tree once.
 */
function ModeChip({ mode }: { mode: RobotMode }) {
  const label = MODE_LABEL[mode];
  return (
    <Chip
      tone={MODE_TONE[mode]}
      title={label}
      className="max-sm:border-0 max-sm:bg-transparent max-sm:px-0"
    >
      <span aria-hidden className="size-2.5 rounded-full bg-current sm:hidden" />
      <span className="max-sm:sr-only">{label}</span>
    </Chip>
  );
}
