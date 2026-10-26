"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { ESTOP_REFUSAL, useConsoleEstop } from "@/hooks/use-console-estop";
import { useTaskTracker } from "@/hooks/use-task-tracker";
import { ignore } from "@/lib/api/mutation-state";
import {
  cancelTask,
  submitTask,
  type TaskStatus,
  type TaskStepRequest,
  type TaskStepState,
} from "@/lib/api/task";

export interface TaskDispatch {
  taskStatus: TaskStatus | null;
  running: boolean;
  /** A submit or cancel request is in flight. */
  busy: boolean;
  cancelable: boolean;
  error: string | null;
  /**
   * Only the submit's refusal, apart from `error` because a refused submit has
   * no row readback to show it in.
   */
  refused: string | null;
  /** Per-step state of the tracked task, keyed by step id. */
  stepStates: ReadonlyMap<string, TaskStepState>;
  /**
   * The run this hook follows, so a job dispatched from this tab is not also
   * announced as an unattended run.
   */
  taskId: string | null;
  /**
   * `name` is the template the steps came from (recorded for the history);
   * `mapName` is the map their coordinates were saved on, so the backend can
   * refuse them on another.
   */
  send: (
    steps: readonly TaskStepRequest[],
    name?: string | null,
    mapName?: string | null,
  ) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

/**
 * Dispatch an authored step list and follow it until terminal — the multi-step
 * sibling of useGoalTask, with the same error order.
 *
 * `send` takes the steps as an argument so this hook is not a second owner of
 * the list (the task draft is).
 *
 * `robotId` is nullable: robot state 404s until localization is valid, and
 * authoring and schedules (whose ids need no robot id) must keep working.
 */
export function useTaskDispatch(robotId: string | null): TaskDispatch {
  const task = useTaskTracker();

  const { track, reset, taskId, steps } = task;
  const { engaged: stopped } = useConsoleEstop();

  const submit = useMutation({
    // The robot id travels in the variables so it is non-null without an assertion.
    mutationFn: async ({
      robot,
      requests,
      name,
      mapName,
    }: {
      robot: string;
      requests: readonly TaskStepRequest[];
      name: string | null;
      mapName: string | null;
    }) => {
      // Refused here as well as greyed at the button: see useGoalTask.
      if (stopped) throw new Error(ESTOP_REFUSAL);
      return submitTask(robot, requests, name, mapName);
    },
    // Before the request, so the last task's readback does not linger under the new rows.
    onMutate: () => reset(),
    onSuccess: (id) => track(id),
  });

  const cancelRun = useMutation({
    // No optimistic CANCELED: whether the workflow stopped is the poll's answer.
    mutationFn: (id: string) => cancelTask(id),
  });

  const { mutateAsync: submitAsync, reset: resetSubmit } = submit;
  const { mutateAsync: cancelAsync, reset: resetCancel } = cancelRun;

  const send = React.useCallback(
    async (
      requests: readonly TaskStepRequest[],
      name: string | null = null,
      mapName: string | null = null,
    ) => {
      if (!robotId || !requests.length) return;
      resetCancel();
      await submitAsync({ robot: robotId, requests, name, mapName }).catch(ignore);
    },
    [robotId, submitAsync, resetCancel],
  );

  const cancel = React.useCallback(async () => {
    if (!taskId) return;
    await cancelAsync(taskId).catch(ignore);
  }, [taskId, cancelAsync]);

  const clear = React.useCallback(() => {
    reset();
    resetSubmit();
    resetCancel();
  }, [reset, resetSubmit, resetCancel]);

  /**
   * Keyed by step id: an index join would mis-attribute a status while the
   * array is shorter than the list, as it is right after creation.
   */
  const stepStates = React.useMemo(
    () => new Map(steps.map((step) => [step.id, step])),
    [steps],
  );

  return {
    taskStatus: task.taskStatus,
    running: task.running,
    busy: submit.isPending || cancelRun.isPending,
    cancelable: task.cancelable,
    error: submit.error?.message ?? task.error ?? cancelRun.error?.message ?? null,
    refused: submit.error?.message ?? null,
    stepStates,
    taskId,
    send,
    cancel,
    clear,
  };
}
