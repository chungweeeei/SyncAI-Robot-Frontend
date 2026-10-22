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
import { PanelPostureControl } from "@/components/dashboard/posture-control";
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
 * Manual drive panel: translation stick (vx/vy — the G23 strafes) and
 * rotation stick (wz), plus keyboard W/S, Q/E, A/D merged in useJoystick. No
 * readout of the commanded vector, by request: the deflection is the read.
 *
 * **Armed = sending.** It comes up disarmed and hears nothing until armed,
 * since an always-live window-level key hook would turn stray keys into
 * motion. While armed, TeleopFooter streams `vectorRef` at 10 Hz; a dropped
 * channel disarms the panel so the button never claims the robot is listening.
 * Not gated on Mapping mode: the backend refuses teleop during an autonomous
 * move and the footer shows that refusal.
 *
 * Movable by the header only, because it parks over the scan's near field;
 * everything below the header is a control, and a missed thumb must not both
 * drive and move the panel. Dragging never interrupts the stream.
 *
 * Max speed scales translation only, applied where the command is computed
 * (lib/teleop/stick.ts). It is the only way to drive slowly by keyboard. It
 * starts at full on every load and is not remembered.
 */
export function ManualControl({ className }: { className?: string }) {
  const [armed, setArmed] = React.useState(false);
  const { engaged: stopped } = useConsoleEstop();
  // The stop disarms the panel and it stays disarmed after release: re-arming
  // is the operator's act. During render rather than in an effect, so not one
  // more frame goes out (unmounting the footer sends the zero frame).
  if (stopped && armed) setArmed(false);
  const [linearScale, setLinearScale] = React.useState(LINEAR_SCALE_DEFAULT);
  const stick = useJoystick(armed, linearScale);
  const handleDrop = React.useCallback(() => setArmed(false), []);

  const panelRef = React.useRef<HTMLDivElement>(null);
  /** Displacement from the caller's anchor, applied as a translate. */
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  /**
   * The active grab, measured once at pointerdown. Clamped to the window, not
   * the viewport it is anchored in: the whole screen is legal parking.
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
    // A press on a header control is not a grab, or capture would steal its
    // click. The arm switch is a role="switch" span, hence the selector. The
    // grip is the exception: a press on it is a drag.
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
      // Keep every edge on screen, or the panel is unrecoverable.
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
    // A tap on the grip resets the panel: the touch form of the double-click.
    // Only a real pointerup counts as a tap.
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
      {/* touch-none, or a touch drag scrolls and ends in pointercancel. 40 px
        * under a finger so the handle and the arm switch are separate targets. */}
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
          {/* A button so the keyboard has the reset. A pointer's click lands on
            * the capturing header instead, hence the tap in onRelease. */}
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
          {/* Phone only: the card puts both wells under one thumb, the drive
            * view splits them to the corners. */}
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
      {/* Above the sticks: the robot stands before it drives. */}
      <PanelPostureControl className="mb-3" />
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
      {/* Mounted only while armed: the mount opens and closes the channel and
        * resets its state. Disarmed shows no line, by request. */}
      {armed && (
        <div className="mt-2.5 border-t border-hairline">
          <TeleopFooter vectorRef={stick.vectorRef} onDrop={handleDrop} />
        </div>
      )}
    </div>
  );
}

/** A stick over its one-word job. */
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

