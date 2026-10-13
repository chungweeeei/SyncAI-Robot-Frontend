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
  /** Null before the first answer under this filter. */
  stats: TaskHistoryStats | null;
  status: "loading" | "ok" | "error";
  error: string | null;
  refresh: () => void;
}

/**
 * The history dashboard's counts, under the list's filter. No
 * `placeholderData` across filters: an old number under a new filter is read
 * as fact in a way a dimmed row is not. No poll, for the list's reason.
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
