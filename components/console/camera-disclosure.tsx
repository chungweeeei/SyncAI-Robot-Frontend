"use client";

import { VideoIcon } from "lucide-react";

import { CameraWindow } from "@/components/console/camera-window";
import {
  StripDisclosure,
  droppedPanel,
} from "@/components/console/strip-disclosure";

/**
 * The camera window's mount in the masthead, beside the drive panel.
 *
 * The robot's camera existed only on /webrtc-test, a developer bench that fills
 * the screen with one video and a page of negotiation readouts. What an
 * operator wants is the opposite: a small picture that stays with them while
 * they work on some other screen — checking a waypoint on /maps, watching a job
 * run from /tasks — which is why this is a movable, resizable window rather
 * than a panel on any one page.
 *
 * **Closing it closes the session.** The robot's worker holds one viewer slot,
 * so a window kept alive behind a hidden flag would be holding the camera away
 * from whoever opens the next one — including the bench, which is where camera
 * faults get diagnosed. See `useCameraStream`: mounted is watching.
 *
 * Opening it therefore negotiates from scratch every time, a second or so of
 * "Connecting" before the first frame. That is the right trade for a panel
 * measured in how often it is *not* open.
 */
export function CameraDisclosure() {
  return (
    <StripDisclosure
      icon={VideoIcon}
      label="Camera window"
      showTitle="Show the robot's camera"
      hideTitle="Hide the robot's camera"
    >
      <CameraWindow className={droppedPanel} />
    </StripDisclosure>
  );
}
