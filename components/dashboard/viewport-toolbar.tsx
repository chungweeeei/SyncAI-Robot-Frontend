"use client";

import * as React from "react";
import {
  CrosshairIcon,
  FocusIcon,
  Grid2x2Icon,
  HandIcon,
  LocateFixedIcon,
  MapPinIcon,
  MapPinPlusIcon,
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
 * The viewport's controls, as two rows of icons along its top edge: this one
 * at the right, MapToolbar below at the left.
 *
 * They used to be two clusters — the pose tools as worded buttons over their
 * read-backs at top left, and the camera and layer toggles as a wrapping row
 * along the bottom — and between them they took both ends of the viewport
 * from the scene. Icons in a strip give it the bottom edge back, and put every
 * "what does a drag do / what is drawn" decision in one place.
 *
 * The split by corner is by what a press touches. Everything here is about the
 * *view* and the commands sent through it: which pose a drag produces, how the
 * camera moves, how far it stands, what is drawn. The left strip is what the
 * operator does *to the map itself* — put the whole of it back in frame, add a
 * stop to it — and sits over the read-back column those actions report into.
 *
 * Nothing here is icon-only, which is the rule grid-toolbar.tsx set for the
 * floor plan editor's tool rows and this one follows. Each button carries its
 * name as its accessible name and in a tooltip beside what a press will do;
 * under a finger, which never hovers, the name is printed under the icon
 * instead. The one sentence a tooltip cannot carry is what to do *next* with a
 * pose tool armed, since the pointer has left the button by then — that is
 * the view's armed hint, under the left strip.
 *
 * Groups are split by hairlines and each is a named `group`, so a screen
 * reader hears "Camera, Move, pressed" rather than a bare "Move". The pose
 * tools keep their own hues (cyan for a goal, amber for an initial pose): the
 * difference between the two is the one a mid-drag glance must not get wrong.
 */
export function ViewportToolbar({
  pick,
  goalLocked,
  onArmGoal,
  onArmInitialPose,
  cameraMode,
  onCameraMode,
  onTopDown,
  onZoomIn,
  onZoomOut,
  layers,
  className,
}: {
  /** Which pose tool a drag on the ground currently belongs to, if any. */
  pick: "goal" | "initial-pose" | null;
  /** A goal is running or on its way; a second one must not be armed. */
  goalLocked: boolean;
  onArmGoal: () => void;
  onArmInitialPose: () => void;
  cameraMode: CameraMode;
  onCameraMode: (mode: CameraMode) => void;
  onTopDown: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  /**
   * Only the layers that have something to draw. A toggle over an empty layer
   * is indistinguishable from a broken one, so the view leaves those out.
   */
  layers: readonly LayerOption[];
  className?: string;
}) {
  return (
    <ToolStrip label="Viewport" className={className}>
        <ToolGroup label="Pose tools">
          <ToolButton
            label="Set goal"
            hint="drag on the map to aim, release to send"
            icon={CrosshairIcon}
            pressed={pick === "goal"}
            // `busy` as well as `running`: the tracker only reports a task once
            // the POST has come back, and a drag is a dispatch, so re-arming in
            // that window would put a second goal on the wire.
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
        {/* Beside the camera modes, not among them, and never pressed: Move and
          * Focus say what a drag does until changed, while this is a one-shot
          * placement the very next drag can orbit out of. A lit segment would
          * claim a view the operator may no longer be in. */}
        <ToolButton
          label="Top down"
          hint="look straight down at the map"
          icon={Grid2x2Icon}
          onClick={onTopDown}
        />

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

        {/* Last, at the strip's outer edge: zoom is otherwise the wheel and, on
          * a phone, the pinch, so these are the buttons reached for least and
          * the ones a thumb finds without looking. One press is one step in
          * either mode: it moves the camera along its line to the target,
          * which is the one form of zoom focus mode does not undo. */}
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
 * The left strip: what the operator does to the map itself. Two buttons, one
 * of them a mode, so it stays a strip rather than a panel — the read-back
 * column that hangs under it is where anything it starts gets reported.
 *
 * Recenter is one-shot and never lit, for the reason Top down is not: the next
 * drag can orbit straight back out of it. Add waypoint is a pick mode like Set
 * goal, and lights the same way while it is armed; it is greyed with no map
 * loaded, because a waypoint is a row on a map and there would be nothing to
 * put it on.
 */
export function MapToolbar({
  placing,
  canPlace,
  onRecenter,
  onArmPlace,
  className,
}: {
  /** The Add waypoint pick is armed. */
  placing: boolean;
  /** There is an active map to add a waypoint to. */
  canPlace: boolean;
  onRecenter: () => void;
  onArmPlace: () => void;
  className?: string;
}) {
  return (
    <ToolStrip label="Map" className={className}>
        <ToolButton
          label="Recenter"
          hint="frame the whole map again"
          icon={ScanSearchIcon}
          onClick={onRecenter}
        />
        <ToolButton
          label="Add waypoint"
          hint={
            canPlace
              ? "press the map to place, drag to aim"
              : "no map is loaded to put one on"
          }
          icon={MapPinPlusIcon}
          pressed={placing}
          disabled={!canPlace}
          onClick={onArmPlace}
        />
    </ToolStrip>
  );
}

export interface LayerOption {
  kind: "scan" | "waypoints" | "path";
  label: string;
  on: boolean;
  /** On, but still downloading; the viewport shows nothing yet. */
  busy?: boolean;
  onToggle: () => void;
}

const LAYER_ICONS = {
  scan: ScanLineIcon,
  waypoints: MapPinIcon,
  path: RouteIcon,
} as const;

