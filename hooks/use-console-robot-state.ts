"use client";

import * as React from "react";

import type { UseRobotState } from "@/hooks/use-robot-state";

/**
 * The console's single robot-state poll, as a context.
 *
 * Down here rather than beside its provider because three hooks read it —
 * useModeSwitch, useWifiConnect and useRobotMapPose all need the shared 1 Hz
 * frame and must not start a second poll of their own — and a hook reaching up
 * into `components/` for it was the one thing that made the layering arrow in
 * CLAUDE.md untrue. The *provider* is a component and stays one, in
 * components/console/robot-state-provider.tsx; only the context object and its
 * accessor live here, which is what lets both sides import downwards.
 */
export const RobotStateContext = React.createContext<UseRobotState | null>(null);

export function useConsoleRobotState(): UseRobotState {
  const value = React.useContext(RobotStateContext);
  if (!value) {
    throw new Error(
      "useConsoleRobotState must be used inside <RobotStateProvider>.",
    );
  }
  return value;
}
