"use client";

import { ZapIcon } from "lucide-react";
import Link from "next/link";
import * as React from "react";

import { ActiveRunControls } from "@/components/console/active-run-controls";
import { CameraDisclosure } from "@/components/console/camera-disclosure";
import { DriveDisclosure } from "@/components/console/drive-disclosure";
import { EstopButton } from "@/components/console/estop-button";
import { EstopLine } from "@/components/console/estop-line";
import { FaultBoundary } from "@/components/console/fault-boundary";
import { RobotStateChip } from "@/components/console/robot-state-chip";
import { SensorDisclosure } from "@/components/console/sensor-disclosure";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { useActiveMap, useMaps } from "@/hooks/use-maps";
import { batteryTone, isCharging } from "@/lib/robot/levels";
import {
  Chip,
  SegmentMeter,
  StripDivider,
  TONE_TEXT,
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
 * The console's masthead, on every screen: robot, mode, the robot's state,
 * map, the running job, and whether the link is alive. Before the first frame it holds its shape
 * with dashes. No page title: the rail already marks where you are.
 *
 * The bottom edge is the heartbeat: a sweep per 1 Hz robot-state frame, amber
 * when one does not arrive. It is the one animation in the console, because a
 * dead link invalidates everything else on screen. Under reduced motion it is
 * a static edge and the link chip says it in text.
 */
export function StatusStrip() {
  const { state, status, silence, updatedAt } = useConsoleRobotState();
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
   * the faults, which under reduced motion only text can do. It is also what
   * says the robot's state beside the mode is no longer a reading
   * (robot-state-chip.tsx goes to a dash under it), and its hover text is the
   * backend's sentence when the robot is what went quiet (`silence`).
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
  const charging = isCharging(state?.state);

  return (
    <header className="relative shrink-0 bg-panel">
      {/* One wrapping row: below `sm` the job block wraps onto its own line
        * (`w-full order-last`). Wrapping rather than a second copy, which
        * would put two Pause buttons in the accessibility tree. */}
      <div className="flex min-h-14 flex-wrap items-center gap-x-2 gap-y-0 pr-[max(0.625rem,env(safe-area-inset-right))] pl-[max(0.625rem,env(safe-area-inset-left))] sm:flex-nowrap sm:gap-x-3.5 sm:pr-[max(1rem,env(safe-area-inset-right))] sm:pl-[max(1rem,env(safe-area-inset-left))]">
        {/* Below `sm` the one cluster that shrinks, the robot id the one
          * thing that truncates: `basis-0 grow` because a wrapping row breaks
          * before it shrinks, which would push the health cluster onto a
          * third line. From `sm` the row no longer wraps and this cluster
          * holds its width (the id capped): the job bar is what gives way,
          * or a tablet's strip squeezed the id to nothing. */}
        <div className="flex min-w-0 shrink items-center gap-1.5 max-sm:grow max-sm:basis-0 sm:shrink-0 sm:gap-3">
          {/* The context, as one line of muted text: which robot, in which
            * mode, on which map. It rarely changes, so it carries no frame
            * or fill — the robot's state after it is the one coloured thing
            * in this group, being the one an operator acts on. Below `md`
            * only the id (the mode stays in the accessibility tree); the map
            * from `xl`, where the job bar no longer needs its room. */}
          <div className="flex min-w-0 items-baseline gap-1.5 text-[13px] text-muted-foreground">
            {/* The robot's name is the link home, like a site's logo. */}
            <Link
              href="/"
              className="readout truncate rounded-sm text-[15px] font-medium text-foreground/85 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:max-w-48"
            >
              {state?.robot_id ?? "—"}
            </Link>
            {/* Mapping vs Navigation changes what every screen means, so it
              * is said here; it is changed on the mapping screen. */}
            {state && <ModeText mode={state.mode} />}
            <span className="hidden min-w-0 items-baseline gap-1.5 xl:flex">
              <Dot />
              <span className="sr-only">Map</span>
              <span title="Map" className="readout max-w-40 truncate">
                {activeMap?.name ?? "—"}
              </span>
            </span>
          </div>
          {/* In a boundary of its own, like the panels on the right: it
            * holds a write, and nothing that can fail shares a fate with
            * the stop. */}
          <FaultBoundary title="Robot state unavailable" compact>
            <RobotStateChip />
          </FaultBoundary>
        </div>

        {/* The running job, read from the backend so it is true for a run
          * another console or a schedule started.
          *
          * `basis-[32rem]` (the full id, step and state) with an auto margin
          * rather than `flex-1`, so the bar does not stretch across a wide
          * screen and ends flush against the health cluster. The row's only
          * auto margin — a second would halve the gap. */}
        <div className="order-last -mx-2.5 flex w-full min-w-0 items-center gap-2 border-t border-hairline px-2.5 py-1.5 sm:order-none sm:mx-0 sm:ml-auto sm:w-auto sm:basis-[32rem] sm:border-0 sm:px-0 sm:py-0">
          <FaultBoundary title="Job controls unavailable" compact>
            <ActiveRunControls />
          </FaultBoundary>
        </div>

        {/* Below `md` it drops its rules and the battery meter (the figure
          * stays), by request: at full width it left the robot id ~14 px on
          * a 375 px phone, and the job bar a sliver on a landscape one. The
          * e2e phone test holds the id whole. */}
        <div className="flex shrink-0 items-center gap-2 sm:gap-3.5">
          <StripDivider className="hidden md:block" />
          {/* A 2 px gap keeps two hover-lit frames from merging into one. */}
          <div className="flex items-center gap-0.5">
            {/* The stop first, by request, in a cluster that never shrinks or
              * wraps, so it is in the same place at every width. Sensor next
              * to the drive panel it tells the operator to stop using. */}
            {/* Outside every boundary: the stop shares a fate with nothing.
              * Each panel beside it fails on its own, as an icon that retries,
              * rather than climbing to global-error and taking the stop too. */}
            <EstopButton />
            <FaultBoundary title="Sensor alerts unavailable" compact>
              <SensorDisclosure />
            </FaultBoundary>
            <FaultBoundary title="Drive panel unavailable" compact>
              <DriveDisclosure />
            </FaultBoundary>
            <FaultBoundary title="Camera unavailable" compact>
              <CameraDisclosure />
            </FaultBoundary>
            {link && (
              // Framed on hover only, like the buttons beside it.
              <Chip
                tone={link.tone}
                title={silence ?? undefined}
                className="border-transparent hover:border-current/40"
              >
                {link.label}
              </Chip>
            )}
            {/* No Wi-Fi bars, by request: they live on the dashboard and in
              * Settings beside their network. */}
          </div>

          <StripDivider className="hidden md:block" />

          {/* No "Batt" label: the meter and the % sign already say it. */}
          <div className="flex items-center gap-2">
            {battery === undefined ? (
              <span className="readout text-[13px] text-muted-foreground">—</span>
            ) : (
              <>
                {/* The bolt at every width, since the meter goes below `md`
                  * and under reduced motion stops climbing. */}
                {charging && (
                  <ZapIcon
                    role="img"
                    aria-label="Charging"
                    className="size-3.5 fill-current text-signal-live"
                  />
                )}
                <SegmentMeter
                  value={battery}
                  tone={batteryTone(battery)}
                  charging={charging}
                  className="hidden md:flex"
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

      {/* The stop in words, under the edge it also turns red. Outside every
        * boundary, like the button: it fails with nothing else. */}
      <EstopLine />
    </header>
  );
}

/** The context line's separator: heard as nothing. */
function Dot() {
  return (
    <span aria-hidden className="text-muted-foreground/60">
      ·
    </span>
  );
}

/**
 * The robot's mode, in the context line's muted text. Navigation is the
 * usual mode and says nothing more; Mapping and Maintenance keep the hue
 * their chip had, in the word alone, since a console in either is not the
 * one an operator expects. Below `md` it is out of sight but still read by a
 * screen reader: a phone's first line is the robot id and its state.
 */
function ModeText({ mode }: { mode: RobotMode }) {
  const tone = MODE_TONE[mode];
  return (
    <span className="flex items-baseline gap-1.5 max-md:sr-only">
      <Dot />
      <span
        title={MODE_LABEL[mode]}
        className={cn("whitespace-nowrap", tone !== "live" && TONE_TEXT[tone])}
      >
        {MODE_LABEL[mode]}
      </span>
    </span>
  );
}
