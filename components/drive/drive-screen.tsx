"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import {
  ArmSwitch,
  SpeedLimit,
  TeleopFooter,
} from "@/components/dashboard/drive-parts";
import { Thumbstick } from "@/components/dashboard/thumbstick";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useJoystick } from "@/hooks/use-joystick";
import { LINEAR_SCALE_DEFAULT } from "@/lib/teleop/stick";

/** The drive view's route. The drive panel links here; the nav rail does not. */
export const DRIVE_PAGE = "/drive";

/**
 * The full-screen drive view: the sticks in the bottom corners of an empty
 * screen, under a phone's two thumbs (the panel's card puts both under one).
 * Nothing behind them, by request. Its own page rather than the panel
 * restyled below sm, which would be two designs in one component's markup.
 *
 * The translation stick is axis-locked (lockToAxis): a thumb on glass has no
 * detent to find straight ahead by. Arm state and limit are this screen's own
 * and start disarmed at full; arming never carries over from another surface.
 * The strip hides the drive panel here, so there is one teleop channel.
 */
export function DriveScreen() {
  const [armed, setArmed] = React.useState(false);
  const { engaged: stopped } = useConsoleEstop();
  // ManualControl's rule: the stop disarms and lifting it does not re-arm.
  if (stopped && armed) setArmed(false);
  const [linearScale, setLinearScale] = React.useState(LINEAR_SCALE_DEFAULT);
  const stick = useJoystick(armed, linearScale);
  const handleDrop = React.useCallback(() => setArmed(false), []);

  const router = useRouter();
  // Opened straight from its URL there is nothing to go back to: go home.
  const leave = () => {
    if (window.history.length > 1) router.back();
    else router.push("/");
  };

  return (
    <div className="relative h-full bg-background">
      <div className="absolute inset-x-3 bottom-3 flex flex-col gap-3">
        <section
          aria-label="Manual drive"
          className="flex w-full max-w-72 flex-col self-center rounded-2xl border border-foreground/15 bg-panel/60 px-3 py-2 shadow-sm backdrop-blur-sm"
        >
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={leave}
              aria-label="Leave the full-screen drive view"
              title="Leave full-screen drive"
              className="-m-1 flex size-7 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none pointer-coarse:size-10"
            >
              <ArrowLeftIcon aria-hidden className="size-5" />
            </button>
            <SpeedLimit
              className="min-w-0 flex-1"
              linearScale={linearScale}
              onLinearScaleChange={setLinearScale}
              armed={armed}
            />
            <ArmSwitch
              armed={armed}
              onArmedChange={setArmed}
              stopped={stopped}
              size="lg"
            />
          </div>
          {armed && (
            <div className="text-center">
              <TeleopFooter vectorRef={stick.vectorRef} onDrop={handleDrop} />
            </div>
          )}
        </section>
        <div className="flex items-end justify-between">
          <div>
            <Thumbstick
              variant="overlay"
              axisLock
              value={stick.left}
              active={stick.leftActive}
              disabled={!armed}
              label="Translation stick"
              onPointer={(value) => stick.setPointer("left", value)}
            />
          </div>
          <div>
            <Thumbstick
              variant="overlay"
              value={stick.right}
              active={stick.rightActive}
              disabled={!armed}
              lockY
              label="Rotation stick"
              onPointer={(value) => stick.setPointer("right", value)}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
