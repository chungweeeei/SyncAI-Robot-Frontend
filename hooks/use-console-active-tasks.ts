"use client";

import * as React from "react";

import type { UseActiveTasks } from "@/hooks/use-active-tasks";

/**
 * The console's single active-tasks poll, as a context.
 *
 * Split from its provider for the reason its twin next door records: the
 * context and its accessor are hook-shaped and belong in this directory, the
 * provider is a component and stays in components/console/. Nothing in `hooks/`
 * reads this one today — both consumers are components — but keeping the two
 * console polls in the same shape is what stops the next reader from
 * concluding the arrangement is accidental.
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
