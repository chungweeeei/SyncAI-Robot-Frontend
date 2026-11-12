"use client";

import * as React from "react";
import { useTrackedDispatch } from "@/hooks/use-tracked-dispatch";
import {
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
 * sibling of useGoalTask, both over useTrackedDispatch (the send, the
 * tracking, the cancel and the error order).
 *
 * `send` takes the steps as an argument so this hook is not a second owner of
 * the list (the task draft is).
 *
 * `robotId` is nullable: robot state 404s until localization is valid, and
 * authoring and schedules (whose ids need no robot id) must keep working.
 */
interface TaskSend {
  robot: string;
  requests: readonly TaskStepRequest[];
  name: string | null;
  mapName: string | null;
}

export function useTaskDispatch(robotId: string | null): TaskDispatch {
  const { task, submit, cancel, clear, busy, error, refused } = useTrackedDispatch({
    kind: "task",
    // The robot id travels in the variables so it is non-null without an assertion.
    dispatch: ({ robot, requests, name, mapName }: TaskSend) =>
      submitTask(robot, requests, name, mapName),
  });
  const { steps } = task;

  const send = React.useCallback(
    async (
      requests: readonly TaskStepRequest[],
      name: string | null = null,
      mapName: string | null = null,
    ) => {
      if (!robotId || !requests.length) return;
      await submit({ robot: robotId, requests, name, mapName });
    },
    [robotId, submit],
  );

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
    busy,
    cancelable: task.cancelable,
    error,
    refused,
    stepStates,
    taskId: task.taskId,
    send,
    cancel,
    clear,
  };
}
