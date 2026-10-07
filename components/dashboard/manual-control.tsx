"use client";

import * as React from "react";
import Link from "next/link";
import { GripHorizontalIcon, Maximize2Icon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { panelFloor } from "@/components/console/strip-disclosure";
import {
  ArmSwitch,
  SpeedLimit,
  TeleopFooter,
} from "@/components/dashboard/drive-parts";
import { Thumbstick } from "@/components/dashboard/thumbstick";
import { DRIVE_PAGE } from "@/components/drive/drive-screen";
import { useConsoleEstop } from "@/hooks/use-console-estop";
import { useJoystick } from "@/hooks/use-joystick";
import { LINEAR_SCALE_DEFAULT } from "@/lib/teleop/stick";
import { isDrag } from "@/lib/map/gesture";
import { cn } from "@/lib/utils";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Manual drive panel: two thumbsticks (left = planar translation vx/vy — the
 * G23 can strafe — right = rotation wz) over the speed limit and the channel's
 * state line. Pointer and keyboard input (W/S drive, Q/E strafe, A/D turn),
 * merged in useJoystick. There is no readout of the commanded vector, by
 * request: the sticks' own deflection is the read, and the numbers were
 * three 5-char values nobody drove by.
 *
 * **Armed = sending.** While armed, TeleopFooter keeps a WS teleop channel
 * open and streams `vectorRef` at 10 Hz to the backend, which clamps, scales
 * and publishes cmd_vel (see use-teleop-sender.ts / lib/ros/teleop-channel.ts
 * for the no-reconnect and watchdog reasoning). If the channel drops, the
 * panel disarms itself — a dead link must not leave the button claiming the
 * robot is listening. Still not gated on RobotMode === "MANUAL", now as a
 * deliberate call rather than a vacuous one: the backend refuses teleop while
 * an autonomous MOVE is executing and the footer surfaces that refusal, which
 * covers the actual hazard without hiding the panel.
 *
 * Input has to be ARMED (the header toggle) before the panel hears anything,
 * and it comes up disarmed. The same deliberate-act grammar as the pick-mode
 * arm buttons, for the same reason: the keyboard half is a window-level WASD
 * hook, and one that is always live would turn stray keys anywhere on the
 * dashboard into stick deflection — noise today, motion once a sender exists.
 * One switch for both input kinds rather than one per kind: pointer input is
 * scoped to the wells and near-harmless alone, so a separate toggle for it
 * would be a second decision with no second question behind it.
 *
 * Every number on this panel is in the cmd hue unconditionally: a joystick has
 * no measured half, so unlike the telemetry rail there is no live/cmd split to
 * draw — cf. the epistemics note in use-locomotion.ts.
 *
 * The panel is movable, by the header only. The callers anchor it bottom-right
 * over the point cloud, which is exactly where the cloud's near-field returns
 * land when the robot backs toward a wall — the operator has to be able to
 * shove the panel off whatever it is covering. The body is not a handle:
 * everything below the header is a control (wells that capture pointers, the
 * arm button), and a panel that slides when a thumb misses a well would turn
 * a bad grab into both a motion command and a moved panel. Dragging never
 * disarms or interrupts the stream — moving the panel mid-drive is the point.
 *
 * The Max speed slider limits translation, vx and vy together, as a fraction
 * of full stick; rotation is not limited. It is the only way to drive slowly
 * from the keyboard, whose deflection is always full. The limit is applied
 * where the command is computed (lib/teleop/stick.ts), so what is sent is
 * the scaled number, not the stick's raw deflection. It starts
 * at full on every page load, so the panel drives as it always has until an
 * operator asks for slower. It is not remembered, so a lowered limit does not
 * outlive the session that chose it, and it can be set before arming.
 */
export function ManualControl({ className }: { className?: string }) {
  const [armed, setArmed] = React.useState(false);
  const { engaged: stopped } = useConsoleEstop();
  // The emergency stop disarms the panel, and keeps it disarmed after the
  // release: arming again is the operator's own act, never a side effect of
  // lifting the stop. A render-time adjust rather than an effect, so not one
  // more frame goes out over the channel (unmounting the footer closes it,
  // which sends the zero frame first).
  if (stopped && armed) setArmed(false);
  const [linearScale, setLinearScale] = React.useState(LINEAR_SCALE_DEFAULT);
  const stick = useJoystick(armed, linearScale);
  // A WS event, not an effect body — the allowed place for setState.
  const handleDrop = React.useCallback(() => setArmed(false), []);

  const panelRef = React.useRef<HTMLDivElement>(null);
  /**
   * Displacement from the caller's anchor, applied as a translate so the
   * `right-3 bottom-3` positioning stays the callers' business — the panel
   * never rewrites top/left, so at {0,0} it sits exactly where it always did
   * and the offset survives the caller changing its corner.
   */
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  /**
   * The active grab, thumbstick's gestureRef idiom: pointer identity plus
   * everything measured once at pointerdown. The clamp range comes from one
   * getBoundingClientRect against the *window* viewport — not the canvas the
   * callers anchor us in: the operator drags the panel off the point cloud
   * precisely because the cloud is where it is in the way, so the whole
   * screen is legal parking. pointermove never forces layout. A window
   * resize mid-offset can strand the panel past the edge until the next grab
   * re-measures and pulls it back in — a tap on the grip resets it for free.
   */
  const dragRef = React.useRef<{
    pointerId: number;
    /** Pressed on the grip, so a release that never dragged is a tap on it. */
    onGrip: boolean;
    originX: number;
    originY: number;
    baseX: number;
    baseY: number;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  } | null>(null);

  const onGrab = (event: React.PointerEvent<HTMLElement>) => {
    // The arm switch lives inside the header; a press on it is a press on it.
    // It is a span with role="switch", not a button (the primitive's default),
    // so it is named here beside the buttons, and so is the drive view's link:
    // a captured press would land its click on the header instead. The grip
    // is a button too, but it is the header's own, so a press on it is a drag
    // (camera-window's rule).
    const button = (event.target as HTMLElement).closest("a, button, [role='switch']");
    if (dragRef.current || (button && !button.hasAttribute("data-move-handle"))) return;
    const panel = panelRef.current;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      onGrip: button !== null,
      originX: event.clientX,
      originY: event.clientY,
      baseX: offset.x,
      baseY: offset.y,
      // How far the panel may still travel in each direction before its edge
      // leaves the window — a panel dragged fully off-screen is unrecoverable.
      minX: offset.x - rect.left,
      maxX: offset.x + (window.innerWidth - rect.right),
      minY: offset.y - rect.top,
      maxY: offset.y + (panelFloor() - rect.bottom),
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDrag = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    setOffset({
      x: clamp(drag.baseX + event.clientX - drag.originX, drag.minX, drag.maxX),
      y: clamp(drag.baseY + event.clientY - drag.originY, drag.minY, drag.maxY),
    });
  };

  // Up, cancel and lost-capture all end the grab; idempotent via the ref
  // check because pointerup is followed by an implicit lostpointercapture.
  const onRelease = (event: React.PointerEvent<HTMLElement>) => {
    const drag = dragRef.current;
    if (drag?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    // A tap on the grip — released inside the drag deadzone of where it was
    // pressed — puts the panel back. It is the finger's path to what the
    // double-click does: a double-tap is not a gesture a phone reports
    // reliably, and a panel parked somewhere bad had no other way home. Only
    // a real release: a cancel or a lost capture is not a tap.
    if (
      event.type === "pointerup" &&
      drag.onGrip &&
      !isDrag(drag.originX, drag.originY, event.clientX, event.clientY)
    ) {
      setOffset({ x: 0, y: 0 });
    }
  };

  return (
    <div
      ref={panelRef}
      style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
      className={cn(overlayPanel, "w-64 p-3", className)}
    >
      {/* touch-none, or a touch drag scrolls the page and the browser answers
        * with pointercancel mid-gesture (thumbstick's rule). 40 px under a
        * finger: the same strip is the drag handle and the arm button, and a
        * 16 px strip with a 20 px button in it was two targets in one thumb.
        * onGrab refuses a press on the button, so at 40 px the two no longer
        * share pixels. */}
      <header
        onPointerDown={onGrab}
        onPointerMove={onDrag}
        onPointerUp={onRelease}
        onPointerCancel={onRelease}
        onLostPointerCapture={onRelease}
        onDoubleClick={() => setOffset({ x: 0, y: 0 })}
        title="Drag to move · tap the grip to reset"
        className="mb-3 flex h-5 cursor-grab touch-none items-center justify-between gap-2 select-none active:cursor-grabbing pointer-coarse:h-10"
      >
        <h2 className="instrument-label flex items-center gap-1.5 text-muted-foreground">
          {/* The grip is the affordance — a bare label row does not announce
            * that it can be grabbed. A button, so a keyboard has the reset
            * too: a pointer's click never reaches it (the header captures
            * the pointer, so the click lands there), which is why the tap is
            * read in onRelease instead. */}
          <button
            type="button"
            data-move-handle
            aria-label="Put the drive panel back where it opened"
            title="Drag to move · tap to reset"
            onClick={() => setOffset({ x: 0, y: 0 })}
            className="-m-0.5 flex cursor-grab items-center rounded-sm p-0.5 pointer-coarse:p-2.5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:cursor-grabbing"
          >
            <GripHorizontalIcon aria-hidden className="size-3" />
          </button>
          Manual drive
        </h2>
        <div className="flex items-center gap-1">
          {/* The way to the drive view, on a phone only: there the card puts
            * both wells under one thumb, and the view is where they come
            * apart to the two corners. From sm up the card is the better
            * fit, so the link is not offered. A link rather than a button,
            * so it is a page the operator can come back from. */}
          <Link
            href={DRIVE_PAGE}
            aria-label="Open the full-screen drive view"
            title="Full-screen drive"
            className="flex size-5 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:hidden pointer-coarse:size-10"
          >
            <Maximize2Icon aria-hidden className="size-3.5" />
          </Link>
          <ArmSwitch armed={armed} onArmedChange={setArmed} stopped={stopped} />
        </div>
      </header>
      <div className="flex items-start justify-center gap-4">
        <LabeledStick caption="Translate">
          <Thumbstick
            value={stick.left}
            active={stick.leftActive}
            disabled={!armed}
            hints={{ up: "W", down: "S", left: "Q", right: "E" }}
            label="Translation stick"
            onPointer={(value) => stick.setPointer("left", value)}
          />
        </LabeledStick>
        <LabeledStick caption="Rotate">
          <Thumbstick
            value={stick.right}
            active={stick.rightActive}
            disabled={!armed}
            lockY
            hints={{ left: "A", right: "D" }}
            label="Rotation stick"
            onPointer={(value) => stick.setPointer("right", value)}
          />
        </LabeledStick>
      </div>
      <SpeedLimit
        className="mt-3"
        linearScale={linearScale}
        onLinearScaleChange={setLinearScale}
        armed={armed}
      />
      {/* Mounting TeleopFooter only while armed is what opens/closes the
        * channel AND what resets its per-session state — the mount boundary
        * replaces any setState-in-effect reset (Next 16 lint). Disarmed shows
        * no line at all, by request: the unlit arm button already says the
        * panel is not listening, so arming grows the panel by one line rather
        * than a placeholder holding the room. */}
      {armed && (
        <div className="mt-2.5 border-t border-hairline">
          <TeleopFooter vectorRef={stick.vectorRef} onDrop={handleDrop} />
        </div>
      )}
    </div>
  );
}

/** A stick over its one-word job. The key hints teach the fingers; this
 *  teaches the split — which hand translates and which rotates. */
function LabeledStick({
  caption,
  children,
}: {
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      {children}
      <span className="instrument-label text-muted-foreground">
        {caption}
      </span>
    </div>
  );
}

