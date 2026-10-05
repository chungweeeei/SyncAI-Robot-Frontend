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
 * Slower than the tracker's 1 Hz: what this follows is a step changing, which
 * takes seconds to minutes, and for a run this tab dispatched the same entry
 * is already being refreshed at 1 Hz by the tracker beside it.
 */
const ACTIVE_RUN_POLL_MS = 2000;

export interface ActiveRun {
  /** The active list's entry: id, kind, name, start time, schedule, map. */
  task: ActiveTask;
  /**
   * The run's own status, from `GET /tasks/{id}`, or null before the first
   * read answers (or while it 404s — see below). This is the only place a
   * paused run is visible: the active list says IN_PROGRESS for it.
   */
  status: TaskStatus | null;
  /** Per-step state as last read; empty until the first populated answer. */
  steps: TaskStepState[];
}

export interface UseActiveRun {
  /**
   * The job the robot is on, or null while the active list is loading,
   * failing or empty. Null on a failing list rather than the last known run,
   * because a Pause button over a memory would act on a job that may have
   * ended — the status strip's own chip already says the list is stale.
   */
  run: ActiveRun | null;
  /**
   * The active list's own status, passed through so the one consumer can
   * tell "no job" from "the list cannot be read" — the second must never be
   * drawn as the first.
   */
  status: ActiveTasksStatus;
  /** The list's clock at its last good read, for the elapsed readout. */
  asOf: string | null;
}

/**
 * The job running on the robot right now, with its per-step state — the
 * read behind the masthead's step readout and its Pause / Resume.
 *
 * Composes the console-wide active-task poll (which run) with a second read
 * of that run's own state (which step, and whether it is held). The two are
 * not folded into ActiveTaskProvider on purpose: that provider's contract is
 * one endpoint at one rate whose failure means one thing, and every reader of
 * its context — the map lock, the /tasks banner, the restart dialog — would
 * re-render on each step tick here. Mounted once from the status strip, which
 * is in the root layout, this read has the same console-wide lifetime.
 *
 * Only the first listed run is followed. The backend refuses a second
 * dispatch while one runs (409 "Robot is busy"), so a longer list is a
 * transient the chip's "×N" already reports.
 *
 * Two off-switches, and both matter. `enabled` goes false the moment the run
 * leaves the active list, and a disabled observer does not tick. A terminal
 * read stops the poll earlier still, during the list's own lag (its poll
 * interval plus the backend's short cache), so a finished run is not read
 * again every two seconds until the list notices.
 *
 * Errors are silent for the tracker's reasons: the read 404s between the
 * dispatch and the workflow's first task, and the workflow query degrades
 * while no worker is polling. `data` survives an errored refetch, so the
 * last read stays on screen; before any read the component shows a dash.
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
