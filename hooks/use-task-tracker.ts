"use client";

import * as React from "react";
import { useQuery, type QueryFunctionContext } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  fetchTaskState,
  isTerminalTaskStatus,
  type TaskStateResponse,
  type TaskStatus,
  type TaskStepState,
} from "@/lib/api/task";

// 1 Hz, like the robot-state poll: plenty for a nav goal or a posture command.
const TASK_POLL_MS = 1000;

/** Stable empty list: useTaskDispatch keys a Map off it. */
export const NO_STEPS: TaskStepState[] = [];

/**
 * The `queryFn` every poller of `queryKeys.task(id)` must use.
 *
 * Reads the id off the key so it cannot go stale relative to the entry. Never
 * replaces a known step list with an empty one: the backend degrades `steps`
 * to [] whenever the workflow query fails (before the first task runs, with no
 * worker, after close), and a real task never has zero steps.
 *
 * Exported because TanStack runs whichever observer's `queryFn` fired, so a
 * second poller with a bare `fetchTaskState` would blank the held list.
 */
export async function fetchHeldTaskState({
  signal,
  queryKey,
  client,
}: QueryFunctionContext<ReturnType<typeof queryKeys.task>>): Promise<TaskStateResponse> {
  const state = await fetchTaskState(queryKey[1], signal);
  if (state.steps.length) return state;
  const held = client.getQueryData<TaskStateResponse>(queryKey);
  // Keep status and error; drop `message`, a live reading nobody can vouch for now.
  return held?.steps.length
    ? { ...state, steps: held.steps.map((step) => ({ ...step, message: "" })) }
    : state;
}

export interface TaskTracker {
  taskStatus: TaskStatus | null;
  /** A submitted task that has not reached a terminal state yet. */
  running: boolean;
  /** Only true while the task can still be cancelled — see `taskId`. */
  cancelable: boolean;
  /** The error message of the first failed step, if any. */
  error: string | null;
  /** Per-step state as last reported; empty until a populated list arrives. */
  steps: TaskStepState[];
  /** Id to cancel; null once terminal, while the status stays until `reset`. */
  taskId: string | null;
  track: (id: string) => void;
  /** Forget the tracked task and its outcome. */
  reset: () => void;
}

/**
 * Follows one submitted task until it is terminal; shared by every flow that
 * dispatches one, so its subtleties do not drift between copies.
 *
 * A keyed query, so two surfaces following one run share a poll, and `track`
 * pointing at a new id leaves the previous run's readback behind for free.
 * Everything returned is derived from that one entry.
 */
export function useTaskTracker(): TaskTracker {
  /** Survives a terminal status (its data keeps the outcome on screen); cleared only by `reset`. */
  const [followedId, setFollowedId] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.task(followedId ?? ""),
    queryFn: fetchHeldTaskState,
    enabled: followedId !== null,
    // Poll errors are silent: the workflow query fails while the workflow is
    // starting and after it ages out of retention, and `data` survives an
    // errored refetch. `error` below is the task's failure, not the poll's.
    // Off at a terminal status, so the outcome stays without a poll.
    refetchInterval: (entry) =>
      isTerminalTaskStatus(entry.state.data?.status) ? false : TASK_POLL_MS,
  });

  const track = React.useCallback((id: string) => setFollowedId(id), []);

  /**
   * **Not to be called while `running`.** A run abandoned here keeps going on
   * the robot with no status and no Cancel on this surface (only
   * ActiveRunBanner can recover it). Every caller is gated on `!running`, and
   * that gating is load-bearing.
   */
  const reset = React.useCallback(() => setFollowedId(null), []);

  // Just dispatched reads as PENDING, not as nothing.
  const taskStatus: TaskStatus | null =
    query.data?.status ?? (followedId !== null ? "PENDING" : null);
  const terminal = isTerminalTaskStatus(query.data?.status);
  const steps = query.data?.steps ?? NO_STEPS;

  return {
    taskStatus,
    running: taskStatus !== null && !terminal,
    cancelable: followedId !== null && !terminal,
    // Off the held list, so a degraded `steps: []` (typically on the terminal
    // poll) cannot leave FAILED with nothing saying why.
    error: steps.find((step) => step.error_msg)?.error_msg || null,
    steps,
    taskId: terminal ? null : followedId,
    track,
    reset,
  };
}
