"use client";

import * as React from "react";

import type { UseActiveTasks } from "@/hooks/use-active-tasks";

/**
 * The console's single active-tasks poll, as a context; split from its
 * provider the same way as use-console-robot-state.ts.
 */
export const ActiveTaskContext = React.createContext<UseActiveTasks | null>(null);

export function useConsoleActiveTasks(): UseActiveTasks {
  const value = React.useContext(ActiveTaskContext);
  if (!value) {
    throw new Error(
      "useConsoleActiveTasks must be used inside <ActiveTaskProvider>.",
    );
  }
  return value;
}
