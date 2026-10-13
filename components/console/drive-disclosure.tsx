"use client";

import { usePathname } from "next/navigation";
import { JoystickIcon } from "lucide-react";

import {
  StripDisclosure,
  droppedPanel,
} from "@/components/console/strip-disclosure";
import { ManualControl } from "@/components/dashboard/manual-control";
import { DRIVE_PAGE } from "@/components/drive/drive-screen";

/**
 * The drive panel's mount in the masthead, so manual drive is reachable from
 * every screen. A disclosure rather than a permanent overlay, which would
 * cover content on the scrolling screens.
 *
 * **Collapsing unmounts the panel**, which disarms it and closes the teleop
 * channel. That is the safe direction: the keys are a window-level listener,
 * and an armed panel while hidden would be a live teleop nothing shows.
 */
export function DriveDisclosure() {
  // Not on the drive view: that would be a second teleop channel and key
  // listener.
  const pathname = usePathname();
  if (pathname === DRIVE_PAGE) return null;
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
