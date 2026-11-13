"use client";

import * as React from "react";
import { useMutationState, useQuery, type Mutation } from "@tanstack/react-query";

import { activeTasksQuery, type ActiveTasksStatus } from "@/hooks/use-active-tasks";
import { useConsoleActiveTasks } from "@/hooks/use-console-active-tasks";
import { NO_STEPS, fetchHeldTaskState } from "@/hooks/use-task-tracker";
import { mutationKeys, queryKeys } from "@/lib/api/query-keys";
import {
  isTerminalTaskStatus,
  type ActiveTask,
  type ActiveTasksResponse,
  type TaskStatus,
  type TaskStepState,
} from "@/lib/api/task";
import { endedRunHeld, endedRunRemainingMs } from "@/lib/task/run";

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
   * read that closed it, so its outcome can be read before the bar goes idle
   * — or, failed, until `dismiss` (`endedRunHeld`). Only ever a closed run,
   * only while the list reads empty (never over an error), and gone the
   * moment another run is listed. Nothing may hold or cancel it; a failed one
   * may be continued, as a new job.
   */
  ended: ActiveRun | null;
  /** Lets go of `ended` now, for a failed run the operator is done with. */
  dismiss: () => void;
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
  // A continuation's kind is per send (the failed job's), so it rides in the
  // variables; the other dispatches name theirs once, in `meta`.
  const kind =
    (variables as { kind?: unknown } | undefined)?.kind ?? mutation.options.meta?.kind;
  const name = (variables as { name?: unknown } | undefined)?.name;
  return {
    id: data,
    run_id: "",
    status: "PENDING",
    started_at: new Date(submittedAt).toISOString(),
    ended_at: null,
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
 * re-render on each step tick. Mounted once, from the status strip, and it
 * has to stay once: every observer of a polled key runs its own interval
 * (TanStack only folds requests that are in flight together), so a second
 * mount is a second `GET /tasks/{id}` every 2 s and a second copy of the
 * state below. Another surface that wants the run reads `useLiveRun`. Only
 * the first listed run is followed (the backend refuses a second dispatch).
 *
 * The poll stops when the run leaves the list, and earlier on a terminal read
 * so a finished run is not re-read during the list's lag. Errors are silent
 * for the tracker's reasons.
 */
export function useActiveRun(): UseActiveRun {
  const { tasks, recentlyEnded, status, asOf } = useConsoleActiveTasks();
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

  // The same for a run anyone started — a schedule, another console — that
  // the backend lists as just ended without ever having listed it running.
  // Only one that ended after this console first read the list: one that
  // closed before is history, not news, and must not flash on a page load.
  const [watchingFrom, setWatchingFrom] = React.useState<string | null>(null);
  if (watchingFrom === null && status === "ok" && asOf !== null) {
    setWatchingFrom(asOf);
  }
  const justEnded = status === "ok" ? (recentlyEnded[0] ?? null) : null;
  const [noticedId, setNoticedId] = React.useState<string | null>(null);
  if (justEnded && justEnded.id !== noticedId && watchingFrom !== null) {
    const news =
      justEnded.ended_at !== null &&
      Date.parse(justEnded.ended_at) > Date.parse(watchingFrom);
    if (justEnded.id === task?.id || justEnded.id === last?.id || !news) {
      setNoticedId(justEnded.id);
    } else if (task === null) {
      setNoticedId(justEnded.id);
      setLast(justEnded);
    }
  }

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
  const held = endedRunHeld(closing.data?.status ?? null);

  // Timed from the closing read while the run may still be listed, so a list
  // that lags past the linger lets go at once rather than flashing the outcome.
  const lastId = last?.id ?? null;
  const [expiredId, setExpiredId] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (lastId === null || closedAt === null || held) return;
    const timer = window.setTimeout(
      () => setExpiredId(lastId),
      endedRunRemainingMs(closedAt, Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [lastId, closedAt, held]);
  const dismiss = React.useCallback(() => {
    if (lastId !== null) setExpiredId(lastId);
  }, [lastId]);

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
    dismiss,
    status,
    asOf,
  };
}

const firstListed = (data: ActiveTasksResponse) => data.tasks[0] ?? null;

/**
 * The listed run and its steps for a surface that only draws them — the
 * dashboard's charge staging point. It reads the two entries `useActiveRun`
 * keeps fresh from the status strip and asks for nothing itself (`enabled:
 * false`: no fetch, no interval), so it costs no request and re-renders only
 * when the run or a step changes, not on each read of the list.
 *
 * Null while the list is loading, failing or empty, as `useActiveRun`'s
 * `run` is, and its steps are empty until the strip's first read lands.
 */
export function useLiveRun(): ActiveRun | null {
  const list = useQuery({ ...activeTasksQuery, enabled: false, select: firstListed });
  const task = list.isError ? null : (list.data ?? null);
  const { data } = useQuery({
    queryKey: queryKeys.task(task?.id ?? ""),
    queryFn: fetchHeldTaskState,
    enabled: false,
  });
  return React.useMemo(
    () =>
      task === null
        ? null
        : { task, status: data?.status ?? null, steps: data?.steps ?? NO_STEPS },
    [task, data],
  );
}
