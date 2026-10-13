"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { ignore, writeState } from "@/lib/api/mutation-state";
import { queryKeys } from "@/lib/api/query-keys";
import { pauseTask, resumeTask } from "@/lib/api/task";
import { requestedHold, type HoldVerb } from "@/lib/task/run";

export interface TaskHold {
  /** Swallows its rejection; see `error`. */
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  /**
   * The verb the backend last accepted for this run. A request, not a reading:
   * PAUSED comes from `GET /tasks/{id}`, and `runPhase` sets the two against
   * each other.
   */
  requested: HoldVerb | null;
  busy: boolean;
  error: string | null;
}

/**
 * POST /api/v1/tasks/{id}/pause and /resume — hold and release a running job.
 *
 * Re-reads only `task(id)`, so the step readout follows at once; `activeTasks`
 * lists a held run as IN_PROGRESS anyway.
 *
 * Nothing optimistic, unlike the schedule pause: a schedule's pause is
 * *applied* by its 200, a task's only *requested* (the ack says PAUSING) — a
 * spoken line or a posture finishes first — so flipping on the ack would show
 * PAUSED over a moving robot.
 *
 * `requested` is derived (requestedHold): a claim only after success and only
 * for its own id. Known blind spot: a resume from *another* console after this
 * tab's pause reads "Pausing…" here until something is pressed or the job
 * ends — the price of an effect-free rule, as with `pendingPolicy`.
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
