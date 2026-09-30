"use client";

import * as React from "react";
import { GripHorizontalIcon } from "lucide-react";

import { overlayPanel } from "@/components/console/instrument";
import { panelFloor } from "@/components/console/strip-disclosure";
import { Thumbstick } from "@/components/dashboard/thumbstick";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { useJoystick } from "@/hooks/use-joystick";
import { useTeleopSender } from "@/hooks/use-teleop-sender";
import {
  LINEAR_SCALE_DEFAULT,
  LINEAR_SCALE_MAX,
  LINEAR_SCALE_MIN,
  LINEAR_SCALE_STEP,
  clampLinearScale,
} from "@/lib/teleop/stick";
import { isDrag } from "@/lib/map/gesture";
import type { TeleopVector } from "@/lib/types/robot";
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
  const [linearScale, setLinearScale] = React.useState(LINEAR_SCALE_DEFAULT);
  const stick = useJoystick(armed, linearScale);
  // Whole percent on the slider, so a step of 10 never accumulates float
  // error; the fraction the command uses is derived from it.
  const speedPercent = Math.round(linearScale * 100);
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
    // so it is named here beside the buttons. The grip is a button too, but
    // it is the header's own, so a press on it is a drag (camera-window's rule).
    const button = (event.target as HTMLElement).closest("button, [role='switch']");
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
        {/* On = listening. A switch rather than a pressed toggle, because
          * this is an on/off state the panel stays in, not a one-shot pick
          * mode; and green, `signal-live`, rather than the cmd hue the pick
          * modes light in — on request, and it reads as "input is live",
          * which is what it is. The Translate / Rotate readout below still
          * goes cmd while armed: that is the value being commanded. The
          * title and aria-label carry the words. */}
        <Switch
          checked={armed}
          onCheckedChange={setArmed}
          aria-label="Arm manual drive input"
          title={
            armed
              ? "Stop capturing pointer and keyboard input"
              : "Capture pointer and keyboard (WS / QE / AD) input"
          }
          className="data-checked:bg-signal-live"
        />
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
      {/* No visible label, by the user's choice: the bar and its percentage
        * are the whole row. The name is still there for a screen reader and
        * on hover, because an unnamed slider reads as "slider, 100". */}
      <div className="mt-3 flex items-center gap-2.5" title="Max speed">
        <Slider
          className="min-w-0 flex-1"
          min={Math.round(LINEAR_SCALE_MIN * 100)}
          max={Math.round(LINEAR_SCALE_MAX * 100)}
          step={Math.round(LINEAR_SCALE_STEP * 100)}
          value={speedPercent}
          onValueChange={(next) => {
            // One thumb, but the wrapper's type admits a range slider's array.
            const percent = typeof next === "number" ? next : next[0];
            setLinearScale(clampLinearScale(percent / 100));
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

/**
 * The live half of the panel: owns the WS channel for exactly as long as it
 * is mounted. Three states on one line: connecting (muted), streaming (cmd
 * hue — this IS the command channel now), and a backend refusal (warn hue;
 * e.g. teleop rejected while an autonomous move runs, decays after ~2 s of
 * the frames no longer being refused).
 */
function TeleopFooter({
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

