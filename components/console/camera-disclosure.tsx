"use client";

import { VideoIcon } from "lucide-react";

import { CameraWindow } from "@/components/console/camera-window";
import {
  StripDisclosure,
  droppedPanel,
} from "@/components/console/strip-disclosure";

/**
 * The camera window's mount in the masthead: a small picture that follows the
 * operator across screens.
 *
 * **Closing it closes the session.** The robot has one viewer slot, and a
 * hidden-but-live window would hold it from the next viewer (see
 * `useCameraStream`: mounted is watching). Each open therefore negotiates
 * afresh, a second of "Connecting".
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
