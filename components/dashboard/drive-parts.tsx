"use client";

import * as React from "react";

import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useTeleopSender } from "@/hooks/use-teleop-sender";
import {
  LINEAR_SCALE_MAX,
  LINEAR_SCALE_MIN,
  LINEAR_SCALE_STEP,
  clampLinearScale,
} from "@/lib/teleop/stick";
import type { TeleopVector } from "@/lib/types/robot";
import { cn } from "@/lib/utils";

/*
 * The pieces both drive surfaces are built from — the masthead's drive panel
 * (ManualControl) and the full-screen drive view (DriveScreen). Each surface
 * owns its own arm state, limit and joystick; these only draw them, so the two
 * cannot drift into different words or different rules for the same control.
 */

/**
 * On = listening. A switch rather than a pressed toggle, because this is an
 * on/off state the panel stays in, not a one-shot pick mode; and green,
 * `signal-live`, rather than the cmd hue the pick modes light in — on
 * request, and it reads as "input is live", which is what it is. The title
 * and aria-label carry the words.
 */
export function ArmSwitch({
  armed,
  onArmedChange,
  stopped,
  size,
}: {
  armed: boolean;
  onArmedChange: (armed: boolean) => void;
  /** The emergency stop is engaged: arming is refused until it is released. */
  stopped: boolean;
  /** `lg` on the drive view, where a thumb rather than a cursor finds it. */
  size?: "default" | "lg";
}) {
  return (
    <Switch
      size={size}
      checked={armed}
      onCheckedChange={onArmedChange}
      disabled={stopped}
      aria-label="Arm manual drive input"
      title={
        stopped
          ? "Emergency stop is engaged. Release it to drive."
          : armed
          ? "Stop capturing pointer and keyboard input"
          : "Capture pointer and keyboard (WS / QE / AD) input"
      }
      className="data-checked:bg-signal-live"
    />
  );
}

/**
 * The Max speed slider: limits translation, vx and vy together, as a
 * fraction of full stick; rotation is not limited. The limit is applied where
 * the command is computed (lib/teleop/stick.ts), so what is sent is the
 * scaled number, not the stick's raw deflection.
 *
 * No visible label, by the user's choice: the bar and its percentage are the
 * whole row. The name is still there for a screen reader and on hover,
 * because an unnamed slider reads as "slider, 100".
 */
export function SpeedLimit({
  linearScale,
  onLinearScaleChange,
  armed,
  className,
}: {
  linearScale: number;
  onLinearScaleChange: (linearScale: number) => void;
  armed: boolean;
  className?: string;
}) {
  // Whole percent on the slider, so a step of 10 never accumulates float
  // error; the fraction the command uses is derived from it.
  const speedPercent = Math.round(linearScale * 100);
  return (
    <div className={cn("flex items-center gap-2.5", className)} title="Max speed">
      <Slider
        className="min-w-0 flex-1"
        min={Math.round(LINEAR_SCALE_MIN * 100)}
        max={Math.round(LINEAR_SCALE_MAX * 100)}
        step={Math.round(LINEAR_SCALE_STEP * 100)}
        value={speedPercent}
        onValueChange={(next) => {
          // One thumb, but the wrapper's type admits a range slider's array.
          const percent = typeof next === "number" ? next : next[0];
          onLinearScaleChange(clampLinearScale(percent / 100));
        }}
        thumbProps={{
          "aria-label": "Max speed",
          getAriaValueText: (_formatted, percent) =>
            `${percent} percent of full speed`,
        }}
      />
      {/* The readout's own rule: the cmd hue only while armed, because a
        * limit on a panel that is not listening is not yet a command. */}
      <span
        className={cn(
          "readout w-9 shrink-0 text-right text-[13px] font-medium",
          armed ? "text-signal-cmd" : "text-muted-foreground",
        )}
      >
        {speedPercent}%
      </span>
    </div>
  );
}

/**
 * The live half of a drive surface: owns the WS channel for exactly as long
 * as it is mounted. Three states on one line: connecting (muted), streaming
 * (cmd hue — this IS the command channel now), and a backend refusal (warn
 * hue; e.g. teleop rejected while an autonomous move runs, decays after ~2 s
 * of the frames no longer being refused).
 *
 * Mount it only while armed: the mount boundary is what opens and closes the
 * channel AND what resets its per-session state, which replaces any
 * setState-in-effect reset (Next 16 lint).
 */
export function TeleopFooter({
  vectorRef,
  onDrop,
}: {
  vectorRef: React.RefObject<TeleopVector>;
  onDrop: () => void;
}) {
  const link = useTeleopSender(vectorRef, onDrop);

  if (link.phase === "connecting") {
    return (
      <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
        Connecting to robot…
      </p>
    );
  }
  if (link.refusal !== null) {
    return (
      <p className="mt-2 text-[11px] leading-tight text-signal-warn">
        {link.refusal}
      </p>
    );
  }
  return (
    <p className="mt-2 text-[11px] leading-tight text-signal-cmd">
      Streaming to robot · 10 Hz
    </p>
  );
}
