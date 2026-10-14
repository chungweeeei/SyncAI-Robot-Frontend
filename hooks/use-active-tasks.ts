"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { fetchActiveTasks, type ActiveTask } from "@/lib/api/task";

// Slower than the 1 Hz robot-state poll: this discovers runs this tab did not
// start (a schedule, another console), none perceivable to the second; this
// tab's own are followed at 1 Hz by useTaskTracker. Longer than the backend's
// 1.5 s snapshot TTL (ACTIVE_TASK_CACHE_TTL_S), so extra tabs hit its cache.
const ACTIVE_TASK_POLL_MS = 2000;

export type ActiveTasksStatus = "loading" | "ok" | "error";

export interface UseActiveTasks {
  /** Running executions, or the last good list while `status` is "error". */
  tasks: ActiveTask[];
  /**
   * Consumers MUST distinguish "error" from an empty list: a failed poll shown
   * as idle would say the robot stands still while it drives.
   */
  status: ActiveTasksStatus;
  /** The backend's clock at the last good read; elapsed times measure from it. */
  asOf: string | null;
  /** Re-read now, for a caller that just changed the answer (e.g. a cancel). */
  refresh: () => void;
}

/**
 * What the robot is executing right now, whoever asked for it. Like
 * useRobotState it keeps the last good value on a transient failure —
 * blanking the list while a run likely continues is the less honest answer.
 * Mounted once, in ActiveTaskProvider.
 */
export function useActiveTasks(
  pollMs: number = ACTIVE_TASK_POLL_MS,
): UseActiveTasks {
  const { data, isPending, isError, refetch } = useQuery({
    queryKey: queryKeys.activeTasks,
    queryFn: ({ signal }) => fetchActiveTasks(signal),
    refetchInterval: pollMs,
  });

  // A run leaving this list has finished, and this poll is the only place that
  // sees every run finish, so it refreshes the history. `data` is structurally
  // shared, so an idle robot costs nothing here.
  const queryClient = useQueryClient();
  const previousIds = React.useRef<Set<string> | null>(null);
  React.useEffect(() => {
    if (!data) return;
    const ids = new Set(data.tasks.map((task) => task.id));
    const previous = previousIds.current;
    previousIds.current = ids;
    if (previous && [...previous].some((id) => !ids.has(id))) {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskHistory });
    }
  }, [data, queryClient]);

  const refresh = React.useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    tasks: data?.tasks ?? [],
    status: isPending ? "loading" : isError ? "error" : "ok",
    asOf: data?.as_of ?? null,
    refresh,
  };
}
