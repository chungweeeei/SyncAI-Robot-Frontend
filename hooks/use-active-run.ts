"use client";

import { useQuery } from "@tanstack/react-query";

import type { ActiveTasksStatus } from "@/hooks/use-active-tasks";
import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { NO_STEPS, fetchHeldTaskState } from "@/hooks/use-task-tracker";
import { queryKeys } from "@/lib/api/query-keys";
import {
  isTerminalTaskStatus,
  type ActiveTask,
  type TaskStatus,
  type TaskStepState,
} from "@/lib/api/task";

/**
 * Slower than the tracker's 1 Hz: a step changes over seconds to minutes, and
 * a run this tab dispatched is already refreshed by the tracker.
 */
const ACTIVE_RUN_POLL_MS = 2000;

export interface ActiveRun {
  task: ActiveTask;
  /**
   * From `GET /tasks/{id}`, null before the first read (or while it 404s). The
   * only place a paused run is visible: the active list says IN_PROGRESS.
   */
  status: TaskStatus | null;
  /** Per-step state as last read; empty until the first populated answer. */
  steps: TaskStepState[];
}

export interface UseActiveRun {
  /**
   * Null while the active list is loading, failing or empty — not the last
   * known run, because a Pause over a memory would act on a job that may have
   * ended.
   */
  run: ActiveRun | null;
  /** So "no job" is never drawn for "the list cannot be read". */
  status: ActiveTasksStatus;
  /** The list's clock at its last good read. */
  asOf: string | null;
}

/**
 * The job running on the robot now, with its per-step state — the read
 * behind the masthead's step readout and Pause / Resume.
 *
 * Kept out of ActiveTaskProvider so that provider's every reader does not
 * re-render on each step tick; mounted once from the status strip. Only the
 * first listed run is followed (the backend refuses a second dispatch).
 *
 * The poll stops when the run leaves the list, and earlier on a terminal read
 * so a finished run is not re-read during the list's lag. Errors are silent
 * for the tracker's reasons.
 */
export function useActiveRun(): UseActiveRun {
  const { tasks, status, asOf } = useConsoleActiveTasks();
  const task = status === "ok" ? (tasks[0] ?? null) : null;

  const { data } = useQuery({
    queryKey: queryKeys.task(task?.id ?? ""),
    queryFn: fetchHeldTaskState,
    enabled: task !== null,
    refetchInterval: (entry) =>
      isTerminalTaskStatus(entry.state.data?.status) ? false : ACTIVE_RUN_POLL_MS,
  });

  return {
    run:
      task === null
        ? null
        : { task, status: data?.status ?? null, steps: data?.steps ?? NO_STEPS },
    status,
    asOf,
  };
}
