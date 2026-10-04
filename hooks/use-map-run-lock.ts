"use client";

import * as React from "react";

import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { mapRunLock, type RunLock } from "@/lib/map/run-lock";

/**
 * Whether `mapName` is held still by a running job, off the console's shared
 * active-tasks poll — no request of its own. The rule, and why it fails
 * closed, is lib/map/run-lock.ts.
 */
export function useMapRunLock(mapName: string | null): RunLock {
  const { tasks, status } = useConsoleActiveTasks();
  const { locked, reason } = mapRunLock({ mapName, tasks, status });
  // Memoised on the two values, so a poll that changed nothing about this map
  // hands back the same object and a memoised child does not re-render.
  return React.useMemo(() => ({ locked, reason }), [locked, reason]);
}
