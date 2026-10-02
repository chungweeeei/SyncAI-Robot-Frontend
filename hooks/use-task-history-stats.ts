"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  fetchTaskHistoryStats,
  type TaskHistoryFilterQuery,
  type TaskHistoryStats,
} from "@/lib/api/task";
import { historyQueryKey } from "@/lib/task/history";

export interface UseTaskHistoryStats {
  /** The counts, or null before the first answer under this filter. */
  stats: TaskHistoryStats | null;
  status: "loading" | "ok" | "error";
  /** The backend's sentence for a failed read, verbatim. */
  error: string | null;
  refresh: () => void;
}

/**
 * How the finished jobs matching a filter ended, counted by the backend — the
 * dashboard above the history list.
 *
 * Read under the same filter the list reads, so the two never describe
 * different runs. No `placeholderData` across filters, unlike the list: the
 * previous filter's numbers held on screen under a new filter would be a
 * claim about runs the new filter excludes, and a number is read as fact in
 * a way a dimmed list of rows is not.
 *
 * No poll, for the list's reason: the active-task poll invalidates the
 * `taskHistory` root when a run finishes, and these keys sit under it (see
 * queryKeys.taskHistoryStats).
 */
export function useTaskHistoryStats(filter: TaskHistoryFilterQuery): UseTaskHistoryStats {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: queryKeys.taskHistoryStats(historyQueryKey(filter)),
    queryFn: ({ signal }) => fetchTaskHistoryStats(filter, signal),
  });

  const refresh = React.useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    stats: data ?? null,
    status: data ? "ok" : isPending ? "loading" : "error",
    error: isError ? error.message : null,
    refresh,
  };
}
