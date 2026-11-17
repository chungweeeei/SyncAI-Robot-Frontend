"use client";

import { DriveScreen } from "@/components/drive/drive-screen";

/**
 * The full-screen drive view. Not gated on a state frame: the teleop channel
 * reports its own connection.
 */
export default function DrivePage() {
  return <DriveScreen />;
}
