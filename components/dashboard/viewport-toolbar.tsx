"use client";

import * as React from "react";
import {
  BanIcon,
  Building2Icon,
  CrosshairIcon,
  CuboidIcon,
  FocusIcon,
  Grid2x2Icon,
  HandIcon,
  LocateFixedIcon,
  MapPinIcon,
  MapPinPlusIcon,
  RadarIcon,
  RouteIcon,
  ScanLineIcon,
  ScanSearchIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";

import {
  ToolButton,
  ToolDivider as Divider,
  ToolGroup,
  ToolStrip,
} from "@/components/console/tool-strip";

type CameraMode = "move" | "focus";

/**
 * The viewport's right-hand strip: what a drag produces, how the camera moves,
 * what is drawn. MapToolbar on the left holds what is done to the map itself.
 *
 * Each button has its name as accessible name and tooltip (grid-toolbar.tsx's
 * rule). What to do next with a pose tool armed is the view's armed hint,
 * since the pointer has left the button by then. Groups are named so a screen
 * reader hears "Camera, Move, pressed". Goal and initial pose keep distinct
 * hues, the difference a mid-drag glance must not get wrong.
 */
export function ViewportToolbar({
  pick,
  goalLocked,
  goalLockReason = null,
  onArmGoal,
  onArmInitialPose,
  autoLocalizeBusy,
  autoLocalizeLock = null,
  onAutoLocalize,
  cameraMode,
  onCameraMode,
  onTopDown,
  onFront,
  onZoomIn,
  onZoomOut,
  layers,
  className,
}: {
  /** Which pose tool a drag on the ground currently belongs to, if any. */
  pick: "goal" | "initial-pose" | null;
  /** A goal is running or on its way; a second one must not be armed. */
  goalLocked: boolean;
  /** Why the map cannot take a goal, for the tooltip. A running goal needs none. */
  goalLockReason?: string | null;
  onArmGoal: () => void;
  onArmInitialPose: () => void;
  /** The robot is searching for where it stands. */
  autoLocalizeBusy: boolean;
  /** Why Auto localize cannot be pressed right now, or null. */
  autoLocalizeLock?: string | null;
  onAutoLocalize: () => void;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
  onTopDown: () => void;
  /**
   * Look at the map level from the front. Omitted, no button: from the
   * front an empty map is a line, so it is offered while the 3D map is up,
   * which also keeps the strip to one row on a phone the rest of the time.
   */
  onFront?: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /** Only the layers that have something to draw. */
  layers: readonly LayerOption[];
  className?: string;
}) {
  return (
    <ToolStrip label="Viewport" compact className={className}>
        <ToolGroup label="Pose tools">
          <ToolButton
            label="Set goal"
            hint={goalLockReason ?? "drag on the map to aim, release to send"}
            icon={CrosshairIcon}
            pressed={pick === "goal"}
            // Includes the POST in flight: the tracker reports a task only once
            // it returns, and re-arming then would send a second goal.
            disabled={goalLocked}
            onClick={onArmGoal}
          />
          <ToolButton
            label="Set initial pose"
            hint="tell the robot where it stands"
            icon={LocateFixedIcon}
            tone="caution"
            pressed={pick === "initial-pose"}
            onClick={onArmInitialPose}
          />
          {/* Same question as Set initial pose without the drag, and the same
            * amber: it overrides the estimate too. One-shot, so never pressed;
            * it pulses while searching. */}
          <ToolButton
            label="Auto localize"
            hint={
              autoLocalizeLock ??
              (autoLocalizeBusy
                ? "searching…"
                : "let the robot find where it stands on the map")
            }
            icon={RadarIcon}
            tone="caution"
            busy={autoLocalizeBusy}
            disabled={autoLocalizeBusy || autoLocalizeLock !== null}
            onClick={onAutoLocalize}
          />
        </ToolGroup>

        <Divider />

        <ToolGroup label="Camera">
          <ToolButton
            label="Move"
            hint="drag pans, right-drag orbits"
            icon={HandIcon}
            pressed={cameraMode === "move"}
            onClick={() => onCameraMode("move")}
          />
          <ToolButton
            label="Focus"
            hint="follow the robot, drag orbits around it"
            icon={FocusIcon}
            pressed={cameraMode === "focus"}
            onClick={() => onCameraMode("focus")}
          />
        </ToolGroup>
        {/* Not a camera mode and never pressed: the next drag can orbit out
          * of it, so a lit button would claim a view no longer held. */}
        <ToolButton
          label="Top down"
          hint="look straight down at the map"
          icon={Grid2x2Icon}
          onClick={onTopDown}
        />
        {/* Its pair: level, from the south, where storeys stack as bands. */}
        {onFront && (
          <ToolButton
            label="Front view"
            hint="look at the map level, from the front"
            icon={Building2Icon}
            onClick={onFront}
          />
        )}

        {layers.length > 0 && (
          <>
            <Divider />
            <ToolGroup label="Layers">
              {layers.map((layer) => (
                <ToolButton
                  key={layer.label}
                  label={layer.label}
                  hint={
                    layer.busy
                      ? "loading…"
                      : layer.on
                        ? "shown — press to hide"
                        : "hidden — press to show"
                  }
                  icon={LAYER_ICONS[layer.kind]}
                  pressed={layer.on}
                  busy={layer.busy}
                  onClick={layer.onToggle}
                />
              ))}
            </ToolGroup>
          </>
        )}

        <Divider />

        {/* Last: the wheel and the pinch zoom too. A step dollies toward the
          * target, the one zoom focus mode does not undo. */}
        <ToolGroup label="Zoom">
          <ToolButton
            label="Zoom in"
            hint="one step closer"
            icon={ZoomInIcon}
            onClick={onZoomIn}
          />
          <ToolButton
            label="Zoom out"
            hint="one step back"
            icon={ZoomOutIcon}
            onClick={onZoomOut}
          />
        </ToolGroup>
    </ToolStrip>
  );
}

/**
 * The left strip: what is done to the map itself. Recenter is one-shot and
 * never lit, like Top down. Add waypoint is a pick mode, greyed with no map.
 */
export function MapToolbar({
  placing,
  canPlace,
  placeLock = null,
  onRecenter,
  onArmPlace,
  className,
}: {
  /** The Add waypoint pick is armed. */
  placing: boolean;
  /** There is an active map to add a waypoint to. */
  canPlace: boolean;
  /** Why the map's waypoints are read-only right now, or null. */
  placeLock?: string | null;
  onRecenter: () => void;
  onArmPlace: () => void;
  className?: string;
}) {
  return (
    <ToolStrip label="Map" compact className={className}>
        <ToolButton
          label="Recenter"
          hint="frame the whole map again"
          icon={ScanSearchIcon}
          onClick={onRecenter}
        />
        <ToolButton
          label="Add waypoint"
          hint={
            !canPlace
              ? "no map is loaded to put one on"
              : (placeLock ?? "press the map to place, drag to aim")
          }
          icon={MapPinPlusIcon}
          pressed={placing}
          disabled={!canPlace || placeLock !== null}
          onClick={onArmPlace}
        />
    </ToolStrip>
  );
}

export interface LayerOption {
  kind: "scan" | "voxels" | "waypoints" | "path" | "zones";
  label: string;
  on: boolean;
  /** On, but still downloading; the viewport shows nothing yet. */
  busy?: boolean;
  onToggle: () => void;
}

const LAYER_ICONS = {
  scan: ScanLineIcon,
  // A solid, where the scan is a sweep: the 3D map is the scan made into
  // cells, and the two sit side by side in the strip.
  voxels: CuboidIcon,
  waypoints: MapPinIcon,
  path: RouteIcon,
  // The map editor's forbidden zone icon.
  zones: BanIcon,
} as const;

