"use client";

import * as React from "react";
import { useMutationState, useQuery, type Mutation } from "@tanstack/react-query";

import type { ActiveTasksStatus } from "@/hooks/use-active-tasks";
import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { NO_STEPS, fetchHeldTaskState } from "@/hooks/use-task-tracker";
import { mutationKeys, queryKeys } from "@/lib/api/query-keys";
import {
  isTerminalTaskStatus,
  type ActiveTask,
  type TaskStatus,
  type TaskStepState,
} from "@/lib/api/task";
import { endedRunRemainingMs } from "@/lib/task/run";

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
  /**
   * The run that has just left the list, for `ENDED_RUN_LINGER_MS` after the
   * read that closed it, so its outcome can be read before the bar goes idle.
   * Only ever a closed run, only while the list reads empty (never over an
   * error), and gone the moment another run is listed. Nothing may act on it.
   */
  ended: ActiveRun | null;
  /** So "no job" is never drawn for "the list cannot be read". */
  status: ActiveTasksStatus;
  /** The list's clock at its last good read. */
  asOf: string | null;
}

/**
 * A job this console sent, as the active list would have listed it. Only the
 * bar's words come from it (kind, name, start); nothing locks or acts on it.
 */
function dispatchedRun(mutation: Mutation<unknown, Error, unknown>): ActiveTask | null {
  const { data, variables, submittedAt } = mutation.state;
  if (typeof data !== "string") return null;
  const kind = mutation.options.meta?.kind;
  const name = (variables as { name?: unknown } | undefined)?.name;
  return {
    id: data,
    run_id: "",
    status: "PENDING",
    started_at: new Date(submittedAt).toISOString(),
    source: "DIRECT",
    schedule_id: null,
    kind: typeof kind === "string" ? kind : null,
    name: typeof name === "string" ? name : null,
    map_name: null,
  };
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

  // The last run the list showed, kept past its leaving so its close can be
  // said. Adjusted during render, by id, rather than in an effect.
  const [last, setLast] = React.useState<ActiveTask | null>(null);
  if (task !== null && task.id !== last?.id) setLast(task);

  // A job sent from this tab that the list never showed: one that failed
  // inside the list's poll interval would otherwise never reach the bar. It
  // is taken once, and only over an empty list, so it stands in as the run
  // that has just left it and never as a run going on.
  const dispatches = useMutationState({
    filters: { mutationKey: mutationKeys.taskDispatch, status: "success" },
    select: dispatchedRun,
  });
  const dispatched = dispatches.reduce<ActiveTask | null>(
    (latest, next) =>
      next && (!latest || next.started_at >= latest.started_at) ? next : latest,
    null,
  );
  const [adoptedId, setAdoptedId] = React.useState<string | null>(null);
  const [unlistedId, setUnlistedId] = React.useState<string | null>(null);
  if (dispatched && dispatched.id !== adoptedId) {
    if (task?.id === dispatched.id || last?.id === dispatched.id) {
      setAdoptedId(dispatched.id);
    } else if (status === "ok" && task === null) {
      setAdoptedId(dispatched.id);
      setUnlistedId(dispatched.id);
      setLast(dispatched);
    }
  }
  // Never listed, so nothing has read it closing yet: polled until a read
  // says it closed, where a run the list dropped is read once.
  const unlisted = last !== null && last.id === unlistedId;

  const { data } = useQuery({
    queryKey: queryKeys.task(task?.id ?? ""),
    queryFn: fetchHeldTaskState,
    enabled: task !== null,
    refetchInterval: (entry) =>
      isTerminalTaskStatus(entry.state.data?.status) ? false : ACTIVE_RUN_POLL_MS,
  });

  const gone = status === "ok" && task === null && last !== null;
  // The same entry as above while the run is listed, so a close read there
  // is already here. A run the list dropped before its own read said it
  // closed gets one more read, which is what the stale-unless-terminal time
  // buys; no poll, since a run off the list has nothing left to report.
  const closing = useQuery({
    queryKey: queryKeys.task(last?.id ?? ""),
    queryFn: fetchHeldTaskState,
    enabled: gone,
    staleTime: (entry) =>
      isTerminalTaskStatus(entry.state.data?.status) ? Infinity : 0,
    refetchInterval: (entry) =>
      unlisted && !isTerminalTaskStatus(entry.state.data?.status)
        ? ACTIVE_RUN_POLL_MS
        : false,
  });
  const closedAt = isTerminalTaskStatus(closing.data?.status)
    ? closing.dataUpdatedAt
    : null;

  // Timed from the closing read while the run may still be listed, so a list
  // that lags past the linger lets go at once rather than flashing the outcome.
  const lastId = last?.id ?? null;
  const [expiredId, setExpiredId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (lastId === null || closedAt === null) return;
    const timer = window.setTimeout(
      () => setExpiredId(lastId),
      endedRunRemainingMs(closedAt, Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [lastId, closedAt]);

  return {
    run:
      task === null
        ? null
        : { task, status: data?.status ?? null, steps: data?.steps ?? NO_STEPS },
    ended:
      gone && closedAt !== null && expiredId !== last.id
        ? {
            task: last,
            status: closing.data?.status ?? null,
            steps: closing.data?.steps ?? NO_STEPS,
          }
        : null,
    status,
    asOf,
  };
}
