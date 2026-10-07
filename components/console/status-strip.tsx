"use client";

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
 * The console's masthead: which robot, what mode, and is the link alive. It is
 * mounted in the root layout, so it is present on every screen — including
 * before the first telemetry frame, where it holds the frame with dashes rather
 * than letting a bare "connecting…" sentence stand in for the whole UI.
 *
 * Deliberately no page title: the rail marks where you are, and repeating it
 * here would spend the widest row on the screen saying nothing measurable.
 *
 * The signature is the bottom edge. syncai_robot_state publishes at 1 Hz, so a
 * green highlight sweeps the hairline once per frame that lands; a frame that
 * does not arrive leaves the sweep unfinished and the edge goes amber. It is the
 * one animated thing in the console and it encodes the only fact that
 * invalidates everything else on screen. (Honoured `prefers-reduced-motion`
 * turns it into a static tinted edge — the STALE / NO SIGNAL chip carries the
 * same information in text.)
 */
export function StatusStrip() {
  const { state, status, updatedAt } = useConsoleRobotState();
  const { engaged: stopped } = useConsoleEstop();
  const { map: activeMap } = useActiveMap();
  const { refresh: refreshMaps } = useMaps();

  // The strip names the map from the catalogue's `active` flag, not from
  // `state.map`: that is the raw config value, a path on the robot's disk
  // (`map/dp2f/gridmap.yaml`), and a file path is not something an operator
  // should read. The catalogue is not polled, though, so the robot's own 1 Hz
  // report is what says when to read it again: a map switched from another
  // console changes `state.map` first, and the catalogue follows on the next
  // read. The first report only primes the ref, because the catalogue is
  // already being read on mount.
  const reportedMap = state?.map;
  const lastReportedMap = React.useRef(reportedMap);
  React.useEffect(() => {
    if (reportedMap === undefined || reportedMap === lastReportedMap.current) return;
    const first = lastReportedMap.current === undefined;
    lastReportedMap.current = reportedMap;
    if (!first) refreshMaps();
  }, [reportedMap, refreshMaps]);

  /**
   * Null while the link is healthy: a chip that says "Link" every second of
   * every day is a readout with one value, and the heartbeat sweep on the
   * strip's bottom edge already says the same thing per frame. What the chip
   * is still here for is the other three states — and for readers who have
   * asked for reduced motion, where that sweep degrades to a static tinted
   * edge and this text is the only thing left that names the fault.
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
      {/* One wrapping row, which is the whole phone layout.
        *
        * Below `sm` the strip cannot hold everything on one line — the robot
        * id, the mode, two 40 px job controls, a readable bar, the drive and
        * camera buttons and the battery come to well over 375 px — so the
        * job block takes `w-full order-last` and wraps onto a second line of
        * its own. From `sm` it is `w-auto` again and the row does not wrap.
        * `flex-wrap` rather than a second element: rendering the controls
        * twice and hiding one would put two Pause buttons and two live
        * readouts in the accessibility tree. */}
      <div className="flex min-h-14 flex-wrap items-center gap-x-2.5 gap-y-0 px-3 sm:flex-nowrap sm:gap-x-3.5 sm:px-4">
        {/* The one cluster that may shrink, and inside it the robot id is the
          * one thing that truncates: at 375 px the health cluster on the right
          * is fixed-width, and it is the part an operator cannot do without.
          *
          * `basis-0 grow` below `sm`, because a wrapping row breaks before it
          * shrinks: at its natural width this cluster plus the health one is
          * ~20 px over a phone, which would put the health cluster on a line
          * of its own and make the strip three rows deep. A zero basis lets
          * the line form first and this cluster take whatever is left. */}
        <div className="flex min-w-0 shrink items-center gap-2.5 max-sm:grow max-sm:basis-0 sm:gap-3.5">
          <span className="readout truncate text-[15px] font-medium">
            {state?.robot_id ?? "—"}
          </span>
          {state && <Chip tone={MODE_TONE[state.mode]}>{MODE_LABEL[state.mode]}</Chip>}
        </div>

        <StripDivider className="hidden sm:block" />

        <div className="hidden min-w-0 items-baseline gap-2 sm:flex">
          <span className="instrument-label text-muted-foreground">Map</span>
          <span className="readout truncate text-[13px]">
            {activeMap?.name ?? "—"}
          </span>
        </div>

        {/* No divider after the map: the job block is flush right now, so a
          * rule here would mark the start of a stretch of nothing. */}

        {/* What the robot is executing, from the job scheduler rather than
          * from this tab — so it is true for a run another console started,
          * or one a schedule started with nobody watching, or one that began
          * before this page was loaded. Two presses and then a long bar.
          *
          * Capped rather than left to grow: on a wide screen the bar would
          * otherwise run half the width of the display to say "2/4 Speak",
          * and a readout whose right edge moves with the window is one the
          * eye has to find again on every screen. 32rem is the full job id,
          * the step and the state word with room to spare.
          *
          * `basis-[32rem]` with an auto margin rather than `flex-1`: the
          * block asks for 32rem, shrinks below it on a narrow window, and
          * the auto margin puts the spare width *before* it, so the bar ends
          * flush against the health cluster instead of trailing empty space
          * after it. The auto margin lives here and nowhere else in the row —
          * two of them would halve the gap between them. */}
        <div className="order-last -mx-3 flex w-full min-w-0 items-center gap-2 border-t border-hairline px-3 py-1.5 sm:order-none sm:mx-0 sm:ml-auto sm:w-auto sm:basis-[32rem] sm:border-0 sm:px-0 sm:py-0">
          <ActiveRunControls />
        </div>

        {/* No auto margin: on a phone the left cluster's `grow` holds this
          * against the right edge, and from `sm` the job block's does. */}
        <div className="flex shrink-0 items-center gap-2.5 sm:gap-3.5">
          <StripDivider />
          {/* A 2 px gap rather than the strip's usual spacing: with their
            * frames hidden until hovered, the drive and camera buttons and
            * the link chip read as one cluster, and the sliver is what keeps
            * two lit frames from merging into one. */}
          <div className="flex items-center gap-0.5">
            {/* First in the health cluster, where the link chip used to stand:
              * icon-only controls need the room to be seen at all, and these
              * are the only things in the strip an operator presses. Sensor
              * first, by request, beside the drive panel it tells the operator
              * to stop using; drive before camera because one commands the
              * robot and the other watches it. */}
            {/* The stop first, by request: at the head of the presses, in a
              * cluster that never shrinks or wraps, so it is whole and in
              * the same place on every screen and at every width. */}
            <EstopButton />
            <SensorDisclosure />
            <DriveDisclosure />
            <CameraDisclosure />
            {link && (
              // Framed on hover only, like the two buttons beside it; the
              // tint and the text keep the tone at rest. `current` is the
              // tone's own text colour, so the frame is the one it had.
              <Chip
                tone={link.tone}
                className="border-transparent hover:border-current/40"
              >
                {link.label}
              </Chip>
            )}
            {/* No Wi-Fi bars here any more, by request. The link chip above
              * still names a dead or stale link, and the SSID, the bars and
              * the dBm stay together on the dashboard's Link group and the
              * Settings screen's Wi-Fi panel, next to the network they
              * belong to. */}
          </div>

          <StripDivider />

          {/* No "Batt" label: the segment meter and the percent sign name the
            * quantity between them, and the row is worth more than a word that
            * repeats what the glyph beside it already shows. Meter first, then
            * the figure: the glyph is the glance, the number is the read. */}
          <div className="flex items-center gap-2">
            {battery === undefined ? (
              <span className="readout text-[13px] text-muted-foreground">—</span>
            ) : (
              <>
                <SegmentMeter value={battery} tone={batteryTone(battery)} />
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

          {/* No clock, by request: the heartbeat on the strip's bottom edge is
            * the freshness reading, and the wall time is on every operator's
            * own machine already. */}
        </div>
      </div>

      {/* The strip's bottom edge is the heartbeat, so it replaces the border. */}
      <div
        aria-hidden
        className={cn(
          "relative h-px w-full overflow-hidden",
          // An engaged stop outranks the link's state: it is the one fact
          // on the strip that says the robot must not be moving. Solid, with
          // the heartbeat's sweep held off until it is released, by request:
          // a green pulse running over it would read as all-clear.
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
