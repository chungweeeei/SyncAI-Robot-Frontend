"use client";

import * as React from "react";

import { useActiveTasksSelect } from "@/hooks/use-console-active-tasks";
import type { ActiveTasksResponse } from "@/lib/api/task";
import { goalLock, type RunLock } from "@/lib/map/run-lock";

const anyRunning = (list: ActiveTasksResponse) => list.tasks.length > 0;
const RUNNING: readonly unknown[] = [true];
const IDLE: readonly unknown[] = [];

/**
 * Whether the dashboard may send a goal while the robot runs a job, off the
 * console's shared active-tasks poll — no request of its own. The rule is
 * lib/map/run-lock.ts's goalLock.
 *
 * Selected down to one boolean, so the viewport this is mounted in is not
 * re-rendered on every read of the list.
 */
export function useGoalLock(): RunLock {
  const { data: running, status } = useActiveTasksSelect(anyRunning);
  const { locked, reason } = goalLock({ tasks: running ? RUNNING : IDLE, status });
  return React.useMemo(() => ({ locked, reason }), [locked, reason]);
}
