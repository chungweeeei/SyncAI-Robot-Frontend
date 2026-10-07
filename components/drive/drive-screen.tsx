"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Minimize2Icon } from "lucide-react";

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
 * The full-screen drive view: the two sticks in the bottom corners of an
 * otherwise empty screen, where a phone's thumbs are. Nothing is drawn
 * behind them, by request: the dashboard's viewport there was a second set
 * of gestures under the thumbs and a toolbar the drive did not need. The masthead's drive panel
 * is a 16rem card with both wells side by side in its middle, which on a
 * phone put them under one thumb; this is the same drive, taken apart for
 * two. The panel links here on a phone only, but the route renders at every
 * width, so a desktop that opens it gets the same layout.
 *
 * Its own page rather than the panel restyled below sm: the card is the
 * right shape for a mouse and a keyboard at every width, and a layout that
 * changed what the panel *was* with the window's width was two designs
 * sharing one component's markup.
 *
 * The sticks are the overlay kind (see thumbstick.tsx), and the
 * translation stick drives one axis at a time — forward / back or strafe,
 * never a diagonal (lockToAxis): a thumb on glass has no detent to find
 * straight ahead by. The panel's sticks stay free, because a mouse has one.
 *
 * Everything the panel arms with is here too — the arm switch, the Max speed
 * limit and the channel line — in one pill above the sticks. The arm state
 * and the limit are this screen's own and start disarmed and at full, like
 * the panel's do on every open: arming is the operator's act on the surface
 * they are holding, never something carried over from another one. The strip
 * does not offer the panel on this route (DriveDisclosure), so there is one
 * teleop channel and one key listener, not two.
 */
export function DriveScreen() {
  const [armed, setArmed] = React.useState(false);
  const { engaged: stopped } = useConsoleEstop();
  // The panel's rule (ManualControl): the stop disarms, and lifting it does
  // not re-arm. A render-time adjust, so not one more frame goes out.
  if (stopped && armed) setArmed(false);
  const [linearScale, setLinearScale] = React.useState(LINEAR_SCALE_DEFAULT);
  const stick = useJoystick(armed, linearScale);
  // A WS event, not an effect body — the allowed place for setState.
  const handleDrop = React.useCallback(() => setArmed(false), []);

  const router = useRouter();
  // Back to wherever the panel was opened from; a view opened straight from
  // its URL has nowhere to go back to inside the console, so it goes home.
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
              <Minimize2Icon aria-hidden className="size-4" />
            </button>
            <SpeedLimit
              className="min-w-0 flex-1"
              linearScale={linearScale}
              onLinearScaleChange={setLinearScale}
              armed={armed}
            />
            <ArmSwitch armed={armed} onArmedChange={setArmed} stopped={stopped} />
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
