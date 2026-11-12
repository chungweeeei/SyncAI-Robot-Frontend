"use client";

import * as React from "react";

import { useQuery } from "@tanstack/react-query";

import { robotStateQuery, type UseRobotState } from "@/hooks/use-robot-state";
import { readStatus } from "@/lib/api/read-state";
import type { ReadStatus } from "@/lib/types/read";
import type { RobotState } from "@/lib/types/robot";

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

/**
 * One value off the console's robot-state poll, re-rendering its caller only
 * when that value changes. `useConsoleRobotState` hands out the whole frame,
 * whose timestamp moves every second, so a screen that reads it for the
 * robot's name re-renders at 1 Hz down to its last list row.
 *
 * A second observer of the provider's entry that never fetches (`enabled:
 * false`): the provider's poll stays the only request, and TanStack notifies
 * this observer only when the selected value — structurally shared, so an
 * object of unchanged fields counts as unchanged — is a different one.
 * Undefined before the first frame.
 */
export function useRobotStateSelect<T>(select: (state: RobotState) => T): T | undefined {
  return useQuery({ ...robotStateQuery, enabled: false, select }).data;
}

const robotId = (state: RobotState) => state.robot_id;

/** The robot's name, or null before the first frame. */
export function useRobotId(): string | null {
  return useRobotStateSelect(robotId) ?? null;
}

const nothing = () => null;

/** The poll's status alone, for a screen that branches on it and draws no frame. */
export function useRobotStateStatus(): ReadStatus {
  const { isPending, isError } = useQuery({ ...robotStateQuery, enabled: false, select: nothing });
  return readStatus({ isPending, isError });
}
