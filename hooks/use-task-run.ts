"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { fetchTaskState, type TaskStepState } from "@/lib/api/task";

export interface UseTaskRun {
  status: "loading" | "ok" | "error";
  steps: TaskStepState[];
  error: string | null;
}

/**
 * The per-step outcome of one *finished* run, mounted only by an expanded
 * history row and never refetched (a closed run cannot change). The same key
 * as useTaskTracker, so a run just watched opens with its steps.
 */
export function useTaskRun(id: string): UseTaskRun {
  const { data, isError, error } = useQuery({
    queryKey: queryKeys.task(id),
    queryFn: ({ signal }) => fetchTaskState(id, signal),
    staleTime: Infinity,
  });

  return {
    status: data ? "ok" : isError ? "error" : "loading",
    steps: data?.steps ?? [],
    error: isError && !data ? error.message : null,
  };
}
