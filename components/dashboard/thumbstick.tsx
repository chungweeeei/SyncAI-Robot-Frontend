"use client";

import * as React from "react";

import { DEADZONE, lockToAxis, type StickValue } from "@/lib/teleop/stick";
import { cn } from "@/lib/utils";

/**
 * Well and knob diameter in px, applied inline so the maths and the drawing
 * cannot disagree. Overlay is thumb-sized, card cursor-sized.
 */
const SIZES = {
  card: { well: 96, knob: 28 },
  overlay: { well: 144, knob: 52 },
} as const;

/**
 * The two faces. The overlay sits on the drive view's bare screen, so its well
 * is a near-white disc with a shadow (a panel tint was invisible there), with
 * a darker knob on it.
 */
const FACES = {
  card: {
    well: "border-hairline bg-elevated/50 inset-shadow-sm",
    guide: "bg-hairline",
    ring: "border-hairline",
    knob: "border-hairline",
    dot: "bg-hairline",
  },
  overlay: {
    well: "border-foreground/15 bg-white/85 shadow-md dark:border-white/30 dark:bg-white/20",
    guide: "bg-foreground/15 dark:bg-white/25",
    ring: "border-foreground/20 dark:border-white/30",
    knob: "border-foreground/30 bg-foreground/15 dark:border-white/50 dark:bg-white/35 backdrop-blur-sm",
    dot: "bg-foreground/50 dark:bg-white/70",
  },
} as const;

/**
 * One virtual thumbstick. Controlled: the deflection comes in as `value`, so a
 * held key moves the knob too. DOM + CSS transform rather than canvas: two
 * circles are cheap to composite and take the theme tokens directly.
 *
 * The round well is the console's one break from rectilinear instrument faces
 * (globals.css), because the command's clamp is a circle.
 *
 * `card` (drive panel) shows key hints; `overlay` (drive screen) is bigger and
 * thumb-driven, with none. Past the deadzone a needle shows the command's
 * direction and length, readable in peripheral vision.
 */
export function Thumbstick({
  value,
  active,
  disabled = false,
  lockY = false,
  variant = "card",
  axisLock = false,
  hints,
  label,
  onPointer,
}: {
  /** Deflection to display, in travel units (the hook clamps it). */
  value: StickValue;
  /** True while this stick is commanding — lights the cmd hue. */
  active: boolean;
  /** Input disarmed: dim the well and refuse pointers (Segmented's idiom). */
  disabled?: boolean;
  /** Rotation stick: draw a horizontal guide instead of up/down hints. */
  lockY?: boolean;
  variant?: keyof typeof SIZES;
  /** Snap a drag to the axis it is further along (lockToAxis). */
  axisLock?: boolean;
  /** Key letters shown at the well's compass points, teaching the shortcut.
   *  The overlay variant draws none. */
  hints?: { up?: string; down?: string; left: string; right: string };
  label: string;
  /** Raw deflection while a pointer drags; null on release or cancel. */
  onPointer: (value: StickValue | null) => void;
}) {
  const { well: WELL, knob: KNOB } = SIZES[variant];
  const TRAVEL = (WELL - KNOB) / 2;
  /** The deadzone drawn as a ring, plus the knob's size so the knob's edge
   *  clears it exactly when the command starts. */
  const DEADZONE_RING = DEADZONE * TRAVEL * 2 + KNOB;
  const face = FACES[variant];
  /**
   * The owning pointer and the well centre, measured once per gesture so
   * pointermove never forces layout.
   */
  const gestureRef = React.useRef<{
    pointerId: number;
    cx: number;
    cy: number;
  } | null>(null);
  /**
   * Gates the knob's transition: 1:1 while dragging (easing feels like
   * latency), a short glide on release and on keyboard moves.
   */
  const [dragging, setDragging] = React.useState(false);

  const report = React.useCallback(
    (event: React.PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      const raw = {
        x: (event.clientX - gesture.cx) / TRAVEL,
        y: (event.clientY - gesture.cy) / TRAVEL,
      };
      onPointer(axisLock ? lockToAxis(raw) : raw);
    },
    [onPointer, TRAVEL, axisLock],
  );

  // Disarmed mid-drag: end the gesture here, or re-arming with the finger
  // still down would silently re-engage the stick.
  React.useEffect(() => {
    if (!disabled || !gestureRef.current) return;
    gestureRef.current = null;
    setDragging(false);
    onPointer(null);
  }, [disabled, onPointer]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // One pointer per stick; each well captures its own, so two sticks work.
    if (disabled || gestureRef.current) return;
    const rect = event.currentTarget.getBoundingClientRect();
    gestureRef.current = {
      pointerId: event.pointerId,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    // Report the press itself; waiting for the first move feels dead.
    report(event);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    report(event);
  };

  // Up, cancel and lost-capture all end it; idempotent, because pointerup is
  // followed by an implicit lostpointercapture.
  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (gestureRef.current?.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    setDragging(false);
    onPointer(null);
  };

  const engaged = active && Math.hypot(value.x, value.y) >= DEADZONE;

  return (
    <div
      role="group"
      aria-label={label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onLostPointerCapture={endGesture}
      // touch-none, or a touch drag scrolls and ends in pointercancel. No
      // long-press menu either: the pause reads as the stick dying.
      onContextMenu={(event) => event.preventDefault()}
      style={{ width: WELL, height: WELL }}
      className={cn(
        "relative shrink-0 touch-none rounded-full border select-none",
        face.well,
        // One opacity on the container, like a disabled Segmented.
        disabled ? "opacity-40" : "cursor-pointer",
      )}
    >
      {/* Axis guides, inset to clear the hints. No vertical one on the
        * rotation stick, which refuses that axis. */}
      <span
        aria-hidden
        className={cn("absolute top-1/2 right-4 left-4 h-px", face.guide)}
      />
      {!lockY && (
        <span
          aria-hidden
          className={cn("absolute top-4 bottom-4 left-1/2 w-px", face.guide)}
        />
      )}
      {/* Deadzone ring, lit while a command is live. */}
      <span
        aria-hidden
        style={{ width: DEADZONE_RING, height: DEADZONE_RING }}
        className={cn(
          "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border",
          engaged ? "border-signal-cmd/50" : face.ring,
        )}
      />
      {hints && variant === "card" && (
        <>
          {hints.up && <Hint className="top-1 left-1/2 -translate-x-1/2">{hints.up}</Hint>}
          {hints.down && (
            <Hint className="bottom-1 left-1/2 -translate-x-1/2">{hints.down}</Hint>
          )}
          <Hint className="top-1/2 left-1.5 -translate-y-1/2">{hints.left}</Hint>
          <Hint className="top-1/2 right-1.5 -translate-y-1/2">{hints.right}</Hint>
        </>
      )}
      {/* The command needle, under the knob. */}
      {engaged && (
        <span
          aria-hidden
          style={{
            width: Math.hypot(value.x, value.y) * TRAVEL,
            transform: `rotate(${Math.atan2(value.y, value.x)}rad)`,
          }}
          className="absolute top-1/2 left-1/2 h-px origin-left bg-signal-cmd/70"
        />
      )}
      <span
        aria-hidden
        style={{
          width: KNOB,
          height: KNOB,
          transform: `translate(calc(-50% + ${value.x * TRAVEL}px), calc(-50% + ${value.y * TRAVEL}px))`,
        }}
        className={cn(
          "absolute top-1/2 left-1/2 flex items-center justify-center rounded-full border bg-panel shadow-sm",
          active
            ? "border-signal-cmd bg-signal-cmd/20 shadow-[0_0_10px_0] shadow-signal-cmd/40"
            : face.knob,
          // Eased only when no pointer is captured — see `dragging`.
          !dragging && "transition-transform duration-100 ease-out motion-reduce:transition-none",
        )}
      >
        {/* Centre dot: reads a deflection against the guides before the needle. */}
        <span
          aria-hidden
          className={cn(
            "rounded-full size-[3px]",
            active ? "bg-signal-cmd" : face.dot,
          )}
        />
      </span>
    </div>
  );
}

/** One key letter at a compass point of the well. */
function Hint({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "instrument-label pointer-events-none absolute text-[10px] text-muted-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
