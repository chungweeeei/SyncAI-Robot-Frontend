"use client";

import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { fetchTaskState, type TaskStepState } from "@/lib/api/task";

export interface UseTaskRun {
  status: "loading" | "ok" | "error";
  steps: TaskStepState[];
  /** The backend's sentence when the run could not be read. */
  error: string | null;
}

/**
 * The per-step outcome of one *finished* run, read once when asked for.
 *
 * Mounted only by an expanded history row: a page is twenty rows, and
 * describing every run up front would be twenty round trips to show detail the
 * operator opens for one. Never refetched once read (`staleTime: Infinity`),
 * because a closed run's steps cannot change.
 *
 * Deliberately the same key useTaskTracker reads, so a run this tab dispatched
 * and just watched finish opens with the steps it already has.
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
