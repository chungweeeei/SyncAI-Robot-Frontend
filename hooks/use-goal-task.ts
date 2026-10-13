"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { ESTOP_REFUSAL, useConsoleEstop } from "@/hooks/use-console-estop";
import { useTaskTracker } from "@/hooks/use-task-tracker";
import { normalizeTheta } from "@/lib/angle";
import { ignore } from "@/lib/api/mutation-state";
import {
  cancelTask,
  sendMoveTask,
  type GoalPose,
  type TaskStatus,
} from "@/lib/api/task";
import { currentStep } from "@/lib/task/run";

export interface GoalTask {
  /** The goal that went out, which the marker and the read-back describe. */
  goal: GoalPose | null;
  taskStatus: TaskStatus | null;
  running: boolean;
  /** A submit or cancel request is in flight. */
  busy: boolean;
  error: string | null;
  /** What the robot says it is doing for the running goal, "" otherwise. */
  message: string;
  cancelable: boolean;
  /** Re-send the pose on screen: the only way back from a failed submit. */
  send: () => Promise<void>;
  /**
   * Dispatch a pose as a one-step MOVE task. The only door in (a drag or a
   * tapped waypoint), so there is one running task, read-back and Cancel.
   */
  sendGoal: (goal: GoalPose) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

/**
 * The drag-a-goal state machine: dispatch a pose as a one-step MOVE task, then
 * track it until terminal.
 *
 * Fires on pointer-up with no Send step: the arrow under the drag is the
 * preview, and a button pressed on every goal stops being read. Deliberateness
 * lives upstream (the tool is armed by a press, one drag disarms it), and a
 * misplaced goal is recoverable with Cancel. Which drag the viewport collects
 * is PointCloudView's single pick mode, not this hook's.
 *
 * Error order is deliberate: a failed submit (no task at all), then the task's
 * own failure, then a failed cancel — a cancel refused because the workflow
 * already closed must not hide why it closed.
 */
export function useGoalTask(robotId: string, mapName: string | null): GoalTask {
  const [goal, setGoal] = React.useState<GoalPose | null>(null);
  const task = useTaskTracker();

  const { track, reset, taskId } = task;
  const { engaged: stopped } = useConsoleEstop();

  const submit = useMutation({
    // The map travels with the goal, so the backend refuses it if the robot
    // has switched maps since it was aimed.
    mutationFn: async (staged: GoalPose) => {
      // Refused here, not only greyed at the button, so no path can send the
      // robot while the stop is engaged.
      if (stopped) throw new Error(ESTOP_REFUSAL);
      return sendMoveTask(robotId, staged, mapName);
    },
    // Before the request: the last run's failure under the new coordinates
    // would read as this goal's. Callers are gated on `running`.
    onMutate: () => reset(),
    onSuccess: (id) => track(id),
  });

  const cancelRun = useMutation({
    mutationFn: (id: string) => cancelTask(id),
  });

  const { mutateAsync: submitAsync, reset: resetSubmit } = submit;
  const { mutateAsync: cancelAsync, reset: resetCancel } = cancelRun;

  const sendGoal = React.useCallback(
    async (next: GoalPose) => {
      // Normalised here too, so the marker and read-back agree with the
      // dispatched heading.
      const staged = { ...next, theta: normalizeTheta(next.theta) };
      setGoal(staged);
      // The last cancel's refusal was about a finished task.
      resetCancel();
      // `staged`, not `goal`: setState is not visible until the next render.
      await submitAsync(staged).catch(ignore);
    },
    [submitAsync, resetCancel],
  );

  const send = React.useCallback(async () => {
    if (!goal) return;
    await sendGoal(goal);
  }, [goal, sendGoal]);

  const cancel = React.useCallback(async () => {
    if (!taskId) return;
    await cancelAsync(taskId).catch(ignore);
  }, [taskId, cancelAsync]);

  const clear = React.useCallback(() => {
    // Marker, status and both mutations' errors describe the same finished task.
    setGoal(null);
    reset();
    resetSubmit();
    resetCancel();
  }, [reset, resetSubmit, resetCancel]);

  return {
    goal,
    taskStatus: task.taskStatus,
    running: task.running,
    busy: submit.isPending || cancelRun.isPending,
    error: submit.error?.message ?? task.error ?? cancelRun.error?.message ?? null,
    message: currentStep(task.steps)?.step.message ?? "",
    cancelable: task.cancelable,
    send,
    sendGoal,
    cancel,
    clear,
  };
}
