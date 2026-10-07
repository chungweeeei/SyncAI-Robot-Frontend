"use client";

import { DriveScreen } from "@/components/drive/drive-screen";

/**
 * The full-screen drive view; the drive panel links here on a phone. Not
 * gated on a state frame, like the panel it stands in for: the teleop
 * channel reports its own connection, which is the one thing this screen
 * needs to know about the robot.
 */
export default function DrivePage() {
  return <DriveScreen />;
}
