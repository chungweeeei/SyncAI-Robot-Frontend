"use client";

import * as React from "react";
import { JoystickIcon } from "lucide-react";

import { ManualControl } from "@/components/dashboard/manual-control";
import { cn } from "@/lib/utils";

/**
 * The drive panel's mount in the masthead, so manual drive is reachable from
 * every screen rather than only from the three that happen to own a viewport.
 *
 * It used to be anchored bottom-right inside the point cloud, the mapping
 * viewport and the gridmap editor, which meant the answer to "can I nudge the
 * robot from here" depended on which page you were on and, on two of them, on
 * what mode that page was in. The strip is the one piece of chrome every route
 * renders, so hanging the panel off it makes that answer the same everywhere.
 *
 * A disclosure rather than a permanent overlay: /maps, /recordings, /tasks and
 * /settings are scrolling documents, and a 16rem panel parked over their
 * bottom-right corner would cover content on screens that have nothing to
 * drive toward. Collapsed it costs one button in the strip.
 *
 * **Collapsing unmounts the panel**, which disarms it and closes the teleop
 * channel — the backend's watchdog then zeroes cmd_vel. That is deliberate and
 * it is the safe direction: the keyboard half of the panel is a window-level
 * WASD listener, so a panel that stayed armed while hidden would be a live
 * teleop with nothing on screen saying so. The sticks are the input; put them
 * away and the robot stops.
 */
export function DriveDisclosure() {
  const [open, setOpen] = React.useState(false);
  const panelId = React.useId();
  const buttonRef = React.useRef<HTMLButtonElement>(null);

  // Escape closes it and hands focus back, the disclosure convention. Scoped
  // to the subtree rather than the window: while the panel is armed the window
  // belongs to the joystick's key handler, and a second global listener on the
  // same events is how one of them ends up eating the other's keys.
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
        onClick={() => setOpen((v) => !v)}
        aria-label="Manual drive panel"
        title={open ? "Hide the manual drive panel" : "Show the manual drive panel"}
        className={cn(
          "flex size-6 items-center justify-center rounded-sm border transition-colors",
          // Open is the cmd hue, like every other operator choice in the
          // console. It is the only state this button shows: whether the robot
          // is listening is the panel's own arm button, one level down.
          open
            ? "border-signal-cmd/50 bg-signal-cmd/12 text-signal-cmd"
            : "border-hairline text-muted-foreground hover:bg-elevated hover:text-foreground",
        )}
      >
        {/* The same joystick the panel's arm button wears, which is a real
          * collision while the panel is open: two cmd-hued joysticks a few
          * pixels apart, switching different things. What separates them is
          * position and size — this one is in the strip and larger — so if
          * they are ever mistaken for each other, the arm toggle is the glyph
          * to change, not this one: a drive panel opened by anything other
          * than a joystick is the less obvious of the two. */}
        <JoystickIcon aria-hidden className="size-3.5" />
      </button>

      {/* mt-6 clears the strip: the button is 24px tall in a 56px row, so its
        * bottom edge sits 16px above the heartbeat hairline, and the remaining
        * 8px is the gap. z-30 because <main> is a later sibling of the header
        * and would otherwise paint over a panel that leaves the strip's box. */}
      <div id={panelId}>
        {open && <ManualControl className="absolute top-full right-0 z-30 mt-6" />}
      </div>
    </div>
  );
}
