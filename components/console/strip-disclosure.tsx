"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An icon button in the masthead and the floating panel it drops: the button,
 * its styling, the ARIA pairing and Escape.
 *
 * **Closing unmounts the panel**, and callers depend on it: the drive panel
 * drops its teleop channel, the camera window releases the robot's one viewer
 * slot. A hidden-but-mounted panel would be a live channel nothing shows.
 *
 * The wrapper is the positioned element the caller anchors the panel to.
 */
export function StripDisclosure({
  icon: Icon,
  label,
  showTitle,
  hideTitle,
  open: controlledOpen,
  onOpenChange,
  alert = false,
  children,
}: {
  icon: LucideIcon;
  /** The accessible name of the button — the panel it opens, named as a thing. */
  label: string;
  /** Hover text for each state; the button is icon-only, so it carries the words. */
  showTitle: string;
  hideTitle: string;
  /** Controlled open state, for a panel that also opens itself (the sensor alert). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Warn glyph plus a corner dot. The dot is not heard, so the caller says the
   * same in `label`.
   */
  alert?: boolean;
  /** Rendered only while open. Position it against the wrapper. */
  children: React.ReactNode;
}) {
  const [ownOpen, setOwnOpen] = React.useState(false);
  const open = controlledOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const panelId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  // Escape closes and returns focus. Scoped to the subtree, not the window,
  // which the armed joystick's key handler owns.
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    setOpen(false);
    buttonRef.current?.focus();
  };

  return (
    <div className="relative" onKeyDown={onKeyDown}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        title={open ? hideTitle : showTitle}
        onClick={() => setOpen(!open)}
        className={cn(
          // The strip's full height: the main press targets, phone or laptop.
          "relative flex size-14 items-center justify-center rounded-sm border transition-colors",
          // Open is the cmd hue. Closed shows a frame only on hover or focus,
          // by request.
          open
            ? "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd"
            : "border-transparent text-muted-foreground hover:border-hairline hover:bg-elevated hover:text-foreground focus-visible:border-hairline",
          // Last, so an alert wins over both.
          alert && "text-signal-warn hover:text-signal-warn",
        )}
      >
        <Icon aria-hidden className="size-5" />
        {alert && (
          <span
            aria-hidden
            className="absolute top-3 right-3 size-2 rounded-full bg-signal-warn ring-2 ring-panel"
          />
        )}
      </button>

      <div id={panelId}>{open && children}</div>
    </div>
  );
}

/**
 * Where a dropped panel sits: under the strip, right-aligned to its button.
 * z-30 because <main>, a later sibling, would paint over it.
 *
 * Below sm it is fixed to the viewport instead, since hung off the button it
 * opened past a phone's left edge. `fixed` is sound because no ancestor has a
 * transform or filter, and the drag clamps measure against `window` anyway.
 */
export const droppedPanel =
  "fixed top-16 right-3 z-30 sm:absolute sm:top-full sm:right-0 sm:mt-2";

/**
 * The lowest a dropped panel may reach: the bottom of <main>, so it cannot be
 * parked over the nav bar below lg.
 */
export function panelFloor(): number {
  const main = document.querySelector("main");
  return main ? main.getBoundingClientRect().bottom : window.innerHeight;
}
