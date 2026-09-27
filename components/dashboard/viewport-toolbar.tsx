"use client";

import * as React from "react";
import {
  CrosshairIcon,
  FocusIcon,
  Grid2x2Icon,
  HandIcon,
  LocateFixedIcon,
  MapPinIcon,
  RouteIcon,
  ScanLineIcon,
} from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type CameraMode = "move" | "focus";
type Tone = "cmd" | "caution";

/**
 * Every control the viewport offers, as one row of icons along its top edge.
 *
 * They used to be two clusters — the pose tools as worded buttons over their
 * read-backs at top left, and the camera and layer toggles as a wrapping row
 * along the bottom — and between them they took both ends of the viewport
 * from the scene. Icons in one strip give it the bottom edge back, and put
 * every "what does a drag do / what is drawn" decision in one place.
 *
 * Nothing here is icon-only, which is the rule grid-toolbar.tsx set for the
 * floor plan editor's tool rows and this one follows. Each button carries its
 * name as its accessible name and in a tooltip beside what a press will do;
 * under a finger, which never hovers, the name is printed under the icon
 * instead. The one sentence a tooltip cannot carry is what to do *next* with a
 * pose tool armed, since the pointer has left the button by then — that is
 * the view's armed hint, under this row.
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
  /**
   * Only the layers that have something to draw. A toggle over an empty layer
   * is indistinguishable from a broken one, so the view leaves those out.
   */
  layers: readonly LayerOption[];
  className?: string;
}) {
  return (
    <TooltipProvider delay={200}>
      <div
        role="toolbar"
        aria-label="Viewport"
        className={cn(overlayPanel, "flex flex-wrap items-center gap-1 p-1", className)}
      >
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
      </div>
    </TooltipProvider>
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

function ToolGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
      {children}
    </div>
  );
}

function Divider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px self-center bg-hairline" />;
}

/**
 * Pressed state is the tone's hue, like every armed or shown control in the
 * console: what a drag does and what is drawn are choices the operator made,
 * and have to read as choices at a glance.
 */
const PRESSED: Record<Tone, string> = {
  cmd: "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd",
  caution: "border-signal-caution/50 bg-signal-caution/12 text-signal-caution",
};

function ToolButton({
  label,
  hint,
  icon: Icon,
  tone = "cmd",
  pressed,
  busy = false,
  disabled = false,
  onClick,
}: {
  label: string;
  /** The tooltip's second half: what a press will do. */
  hint: string;
  icon: typeof HandIcon;
  tone?: Tone;
  /** Omitted for a one-shot action, which has no state to report. */
  pressed?: boolean;
  busy?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={label}
            aria-pressed={pressed}
            aria-busy={busy || undefined}
            disabled={disabled}
            onClick={onClick}
            className={cn(
              "flex size-7 items-center justify-center rounded-sm border transition-colors disabled:opacity-40",
              "pointer-coarse:h-10 pointer-coarse:w-auto pointer-coarse:min-w-10 pointer-coarse:flex-col pointer-coarse:gap-0.5 pointer-coarse:px-1",
              pressed
                ? PRESSED[tone]
                : "border-transparent text-muted-foreground hover:bg-elevated hover:text-foreground disabled:hover:bg-transparent",
            )}
          />
        }
      >
        <Icon aria-hidden className={cn("size-4", busy && "animate-pulse")} />
        {/* A finger never hovers, so it never reads the tooltip; under a
          * coarse pointer the button is 40 px tall and has room to say it. */}
        <span className="instrument-label hidden text-[9px] leading-none pointer-coarse:block">
          {label}
        </span>
      </TooltipTrigger>
      {/* Hidden under a coarse pointer: the label is already printed on the
        * button, and a tap would otherwise leave a tooltip standing over the
        * scene. */}
      <TooltipContent side="bottom" className="pointer-coarse:hidden">
        <span className="font-medium">{label}</span>
        <span className="opacity-70">— {hint}</span>
      </TooltipContent>
    </Tooltip>
  );
}
