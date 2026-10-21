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
 * Parts shared by ManualControl and DriveScreen. Each surface owns its state;
 * these only draw it, so the two cannot drift apart.
 */

/**
 * On = listening. A switch, since it is a state the panel stays in, and green
 * (`signal-live`) by request: input is live.
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
 * Max speed: scales translation (vx and vy), not rotation, where the command
 * is computed (lib/teleop/stick.ts). No visible label, by request; the name is
 * on hover and for screen readers, or it reads as "slider, 100".
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
  // Whole percent on the slider, so steps never accumulate float error.
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
      {/* Cmd hue only while armed: until then it is not a command. */}
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
 * Owns the teleop channel for exactly as long as it is mounted, so mount it
 * only while armed; the mount also resets its state. One line while
 * connecting or while the backend refuses (e.g. during an autonomous move),
 * and nothing once connected: the channel only sends while an input
 * deflects, so a standing "streaming" line would claim frames that are not
 * going out.
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
  return null;
}
