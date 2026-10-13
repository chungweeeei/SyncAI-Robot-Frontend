"use client";

import * as React from "react";

import { ActiveTaskContext } from "@/hooks/use-console-active-tasks";
import { useActiveTasks } from "@/hooks/use-active-tasks";

/**
 * The console's single GET /api/v1/active_tasks poll, mounted once in the
 * root layout so "is the robot executing something" survives navigation on
 * every screen (not the telemetry socket, which only the dashboard opens).
 *
 * A separate provider from RobotStateProvider: different endpoint, rate and
 * failure, and one shared `status` could not say which link broke. The
 * context lives in hooks/use-console-active-tasks.ts.
 */
export function ActiveTaskProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const value = useActiveTasks();

  return (
    <ActiveTaskContext.Provider value={value}>
      {children}
    </ActiveTaskContext.Provider>
  );
}
