"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ignore, writeState } from "@/lib/api/mutation-state";
import { queryKeys } from "@/lib/api/query-keys";
import { pauseTask, resumeTask } from "@/lib/api/task";
import { requestedHold, type HoldVerb } from "@/lib/task/run";

export interface TaskHold {
  /** Ask the backend to hold the run. Swallows its rejection; see `error`. */
  pause: () => Promise<void>;
  /** Ask the backend to release it. */
  resume: () => Promise<void>;
  /**
   * The verb the backend most recently accepted for this run, or null. A
   * request, not a reading: PAUSED is what `GET /tasks/{id}` says, and
   * `runPhase` sets the two against each other to name the pending window.
   */
  requested: HoldVerb | null;
  /** True while either request is in flight. */
  busy: boolean;
  /** The last request's refusal — the backend's sentence, verbatim. */
  error: string | null;
}

/**
 * POST /api/v1/tasks/{id}/pause and /resume — hold and release a running job.
 *
 * A command hook in the use-cancel-task family: it changes no cached
 * resource, so it invalidates nothing but the one read that reports what the
 * robot did with the request. `queryKeys.task(id)` is re-read on success so
 * the step readout follows at once instead of on its next 2 s tick;
 * `activeTasks` needs nothing, because a held run is still listed, still as
 * IN_PROGRESS — the list cannot see inside the run.
 *
 * Nothing optimistic, and the contrast with use-schedules' PAUSE_SETTLE_MS
 * is the point. A schedule's pause is *applied* by the time its 200 returns,
 * and only Temporal's read lags; a task's pause is only *requested* by then
 * (the ack says PAUSING): a MOVE is interrupted at once, but a line being
 * spoken or a posture being taken finishes first, and the run holds before
 * the next step. Flipping the readout on the ack would show PAUSED over a
 * robot still moving.
 *
 * `requested` is derived from the two mutations rather than kept in state
 * (see requestedHold): it is a claim only once the request succeeded, and
 * only about the id it was made for, so a new job in the active list retires
 * it without an effect. The known blind spot: once this tab's pause is
 * confirmed, a resume sent from *another* console flips the read back to
 * IN_PROGRESS and this tab reads "Pausing…" until it presses something or the
 * job ends. That is the price of an effect-free rule that is right for every
 * single-console flow; `pendingPolicy` in use-locomotion.ts pays the same.
 */
export function useTaskHold(taskId: string | null): TaskHold {
  const queryClient = useQueryClient();

  const follow = (id: string) =>
    void queryClient.invalidateQueries({ queryKey: queryKeys.task(id) });

  const pauseMutation = useMutation({
    mutationFn: (id: string) => pauseTask(id),
    onSuccess: (_result, id) => follow(id),
  });
  const resumeMutation = useMutation({
    mutationFn: (id: string) => resumeTask(id),
    onSuccess: (_result, id) => follow(id),
  });

  const { mutateAsync: pauseAsync } = pauseMutation;
  const { mutateAsync: resumeAsync } = resumeMutation;

  const pause = React.useCallback(async () => {
    if (taskId === null) return;
    await pauseAsync(taskId).catch(ignore);
  }, [taskId, pauseAsync]);

  const resume = React.useCallback(async () => {
    if (taskId === null) return;
    await resumeAsync(taskId).catch(ignore);
  }, [taskId, resumeAsync]);

  const { busy, error } = writeState([pauseMutation, resumeMutation]);

  return {
    pause,
    resume,
    requested: requestedHold(pauseMutation, resumeMutation, taskId),
    busy,
    error,
  };
}
