"use client";

import * as React from "react";

import type { UseRobotState } from "@/hooks/use-robot-state";

/**
 * The console's single robot-state poll, as a context. Here rather than beside
 * its provider (components/console/robot-state-provider.tsx) because hooks
 * read it, and a hook may not import from `components/`.
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
