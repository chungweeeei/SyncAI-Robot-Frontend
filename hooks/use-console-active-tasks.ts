"use client";

import * as React from "react";

import { useQuery } from "@tanstack/react-query";

import { activeTasksQuery, type UseActiveTasks } from "@/hooks/use-active-tasks";
import { readStatus } from "@/lib/api/read-state";
import type { ActiveTasksResponse } from "@/lib/api/task";
import type { ReadStatus } from "@/lib/types/read";

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

/**
 * One answer off the console's active-tasks poll, re-rendering its caller
 * only when that answer changes — the list's `as_of` moves on every read, so
 * reading the list through the context re-renders a screen each 2 s for an
 * answer that had not changed.
 *
 * An observer of the provider's entry that never fetches (`enabled: false`),
 * as use-console-robot-state.ts's selectors are: the provider's poll stays
 * the only request. `status` comes with it because an unreadable list is
 * not an empty one, and on an error the entry still holds the last good
 * list — `data` is that list's answer, for the caller to distrust.
 */
export function useActiveTasksSelect<T>(select: (list: ActiveTasksResponse) => T): {
  data: T | undefined;
  status: ReadStatus;
} {
  const { data, isPending, isError } = useQuery({ ...activeTasksQuery, enabled: false, select });
  return { data, status: readStatus({ isPending, isError }) };
}
