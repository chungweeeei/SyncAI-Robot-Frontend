"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import {
  TERMINAL_TASK_STATUSES,
  fetchTaskState,
  type TaskStateResponse,
  type TaskStatus,
  type TaskStepState,
} from "@/lib/api/task";

// A workflow reports through a Temporal query, which is only as fresh as the
// poll; 1 Hz matches the robot-state poll and is plenty for either a nav goal
// (minutes) or a posture command (seconds).
const TASK_POLL_MS = 1000;

/**
 * Shared so the pre-first-response window does not hand a fresh array to every
 * render — useTaskDispatch keys a Map off this and would rebuild it each time.
 */
const NO_STEPS: TaskStepState[] = [];

export interface TaskTracker {
  taskStatus: TaskStatus | null;
  /** A submitted task that has not reached a terminal state yet. */
  running: boolean;
  /** Only true while the task can still be cancelled — see `taskId`. */
  cancelable: boolean;
  /** The error message of the first failed step, if any. */
  error: string | null;
  /**
   * Per-step state of the tracked task, as the workflow query last reported it.
   * Empty until the first poll answers with a populated list — a multi-step flow
   * joins it to its own rows by step id.
   */
  steps: TaskStepState[];
  /**
   * Id of the task being polled, for callers that need to cancel it. Null once
   * the run is terminal, which is the signal that there is nothing left to
   * stop; the *status* stays on screen until `reset`.
   */
  taskId: string | null;
  /** Start polling a freshly submitted task. */
  track: (id: string) => void;
  /** Forget the tracked task and its outcome. */
  reset: () => void;
}

function isTerminal(status: TaskStatus | undefined): boolean {
  return status !== undefined && TERMINAL_TASK_STATUSES.includes(status);
}

/**
 * Follows one submitted task until it is terminal.
 *
 * Shared by every one-step-task flow in the console (nav goal, posture) rather
 * than reimplemented per flow: the subtleties below — holding a step list the
 * backend degraded to empty, going quiet at a terminal status while the status
 * itself stays on screen, and swallowing query errors instead of showing them —
 * are the kind that drift apart once there are two copies.
 *
 * A keyed query rather than the hand-rolled `setInterval` it replaces. The key
 * is what makes two surfaces following the same run share one poll instead of
 * opening one each, and it is also what clears the readback for free: `track`
 * points the hook at a new id, so the previous run's status, steps and error
 * are simply not this entry's data. Nothing here has to null them.
 *
 * Everything this hook returns is derived from that one entry. There is no
 * second copy of the status in state that could disagree with it.
 */
export function useTaskTracker(): TaskTracker {
  const queryClient = useQueryClient();
  /**
   * The run being followed. Survives a terminal status — the query stops
   * polling but its data is what keeps the outcome on screen — and is cleared
   * only by `reset`.
   */
  const [followedId, setFollowedId] = React.useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.task(followedId ?? ""),
    queryFn: async ({ signal, queryKey }) => {
      // The id off the key, not off the closure: the key is what this request
      // belongs to, and it cannot go stale relative to the entry it writes.
      const state = await fetchTaskState(queryKey[1], signal);
      // Never overwrite a known step list with an empty one. get_task_state
      // degrades `steps` to [] whenever the workflow query fails — in the
      // window before the workflow's first task executes, when no worker is
      // polling this robot's queue, and again once the execution has closed —
      // and each of those would otherwise blank the per-step readback the
      // operator is watching. An empty list is never meaningful here: the
      // composer refuses to dispatch a zero-step task.
      if (state.steps.length) return state;
      const held = queryClient.getQueryData<TaskStateResponse>(queryKey);
      return held?.steps.length ? { ...state, steps: held.steps } : state;
    },
    enabled: followedId !== null,
    // Silent, for the same reason the hand-rolled version swallowed its
    // errors: the workflow query fails while Temporal is starting the
    // workflow, and again once the task ages out of Temporal's retention.
    // Neither is worth showing, and `data` survives an errored refetch, so the
    // last known status stays put. `error` below is the *task's* failure, not
    // the poll's.
    //
    // Off at a terminal status, which is what tears the poll down while the
    // outcome stays on screen. The interval also pauses while the tab is
    // hidden and resumes on return, so a readback is at most one tick stale —
    // the same deal the active-task poll next door takes.
    refetchInterval: (entry) =>
      isTerminal(entry.state.data?.status) ? false : TASK_POLL_MS,
  });

  const track = React.useCallback((id: string) => setFollowedId(id), []);

  /**
   * **Not to be called while `running`.** Forgetting the id is what clears the
   * readback, so unlike the poll effect this replaced — which kept ticking and
   * put the status back on the next tick — this one does not come back. A run
   * abandoned here keeps going on the robot with no status and no Cancel on
   * this surface, recoverable only through ActiveRunBanner.
   *
   * Every caller today is gated: the three `clear` buttons render only in a
   * `!running` branch, and the dispatch paths that reset first are all disabled
   * while a task is in flight. That gating is load-bearing, not tidiness.
   */
  const reset = React.useCallback(() => setFollowedId(null), []);

  // Before the first response there is no data, and "we have just dispatched"
  // has to read as PENDING rather than as nothing — the caller's panel is
  // already showing the goal it sent.
  const taskStatus: TaskStatus | null =
    query.data?.status ?? (followedId !== null ? "PENDING" : null);
  const terminal = isTerminal(query.data?.status);
  const steps = query.data?.steps ?? NO_STEPS;

  return {
    taskStatus,
    running: taskStatus !== null && !terminal,
    cancelable: followedId !== null && !terminal,
    // Read off the *held* list, so a response that degraded `steps` to [] no
    // longer takes the sentence away while leaving the failed rows on screen.
    // The hand-rolled version recomputed this from each fresh response and did
    // exactly that, most visibly on the terminal poll of a run whose execution
    // had already closed: FAILED with nothing saying why, and no Retry.
    error: steps.find((step) => step.error_msg)?.error_msg || null,
    steps,
    taskId: terminal ? null : followedId,
    track,
    reset,
  };
}
