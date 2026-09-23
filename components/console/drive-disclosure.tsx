"use client";

import { JoystickIcon } from "lucide-react";

import {
  StripDisclosure,
  droppedPanel,
} from "@/components/console/strip-disclosure";
import { ManualControl } from "@/components/dashboard/manual-control";

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
 *
 * The trigger wears the same joystick as the panel's arm button, which is a
 * real collision while the panel is open: two cmd-hued joysticks a few pixels
 * apart, switching different things. What separates them is position and size.
 * If they are ever mistaken for each other, the arm toggle is the glyph to
 * change, not this one — a drive panel opened by anything other than a joystick
 * is the less obvious of the two.
 */
export function DriveDisclosure() {
  return (
    <StripDisclosure
      icon={JoystickIcon}
      label="Manual drive panel"
      showTitle="Show the manual drive panel"
      hideTitle="Hide the manual drive panel"
    >
      <ManualControl className={droppedPanel} />
    </StripDisclosure>
  );
}
