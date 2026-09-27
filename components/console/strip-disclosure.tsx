"use client";

import * as React from "react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * An icon button in the masthead and the floating panel it drops.
 *
 * The strip is the one piece of chrome every route renders, which makes it the
 * place to hang anything an operator should be able to reach without first
 * navigating to the screen that happens to own it. Two things do so far — the
 * drive panel and the camera window — and this holds what they share: the
 * button, its expanded styling, the ARIA pairing and Escape.
 *
 * **Closing unmounts the panel**, and both callers depend on that rather than
 * merely tolerating it: the drive panel disarms and drops its teleop channel,
 * the camera window closes its session and hands the robot's one viewer slot
 * back. A panel kept alive behind a hidden flag would be a live command channel
 * or a held camera with nothing on screen saying so.
 *
 * The panel is positioned by the caller and anchored to this button, which is
 * why the wrapper is the positioned element.
 */
export function StripDisclosure({
  icon: Icon,
  label,
  showTitle,
  hideTitle,
  children,
}: {
  icon: LucideIcon;
  /** The accessible name of the button — the panel it opens, named as a thing. */
  label: string;
  /** Hover text for each state; the button is icon-only, so it carries the words. */
  showTitle: string;
  hideTitle: string;
  /** Rendered only while open. Position it against the wrapper. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  // Escape closes and hands focus back, the disclosure convention. Scoped to
  // the subtree rather than the window: while the drive panel is armed the
  // window belongs to the joystick's key handler, and a second global listener
  // on the same events is how one of them ends up eating the other's keys.
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
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex size-6 items-center justify-center rounded-sm border transition-colors pointer-coarse:size-10",
          // Open is the cmd hue, like every other operator choice in the
          // console. It is the only state these buttons show: what the panel
          // is doing once open is the panel's own business.
          open
            ? "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd"
            : "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground",
        )}
      >
        <Icon aria-hidden className="size-3.5" />
      </button>

      <div id={panelId}>{open && children}</div>
    </div>
  );
}

/**
 * Where a dropped panel sits: under the strip, right edge aligned with the
 * button that opened it.
 *
 * mt-6 clears the strip — the button is 24px tall in a 56px row, so its bottom
 * edge sits 16px above the heartbeat hairline and the remaining 8px is the gap.
 * z-30 because <main> is a later sibling of the header and would otherwise
 * paint over anything that leaves the strip's box.
 *
 * Below sm the panel is anchored to the viewport instead of the button: the
 * button sits 100–240 px from the right edge of a phone, and a 256–320 px
 * panel hung off it opened past the left edge of a body that cannot scroll.
 * `fixed` inside the `relative` wrapper is sound here because nothing between
 * the panel and <body> has a transform or filter — overlayPanel's backdrop
 * blur is on the panel itself — and both panels' drag clamps measure their
 * rect against `window`, which is what a fixed box is positioned in. top-16
 * is the 56 px strip, its hairline and the same 8 px gap.
 */
export const droppedPanel =
  "fixed top-16 right-3 z-30 sm:absolute sm:top-full sm:right-0 sm:mt-6";

/**
 * The lowest a dropped panel may be dragged or grown to: the top of the nav
 * when it is a bar under the page (below lg), the bottom of the window when
 * it is a rail beside it. The panels are chrome, so knowing that <main> is
 * the region between the strip and the nav is theirs to know — the window's
 * height was the previous answer, and it let a panel be parked over the tabs.
 */
export function panelFloor(): number {
  const main = document.querySelector("main");
  return main ? main.getBoundingClientRect().bottom : window.innerHeight;
}
