"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useTaskTracker } from "@/hooks/use-task-tracker";
import { normalizeTheta } from "@/lib/angle";
import { ignore } from "@/lib/api/mutation-state";
import {
  cancelTask,
  sendMoveTask,
  type GoalPose,
  type TaskStatus,
} from "@/lib/api/task";

export interface GoalTask {
  /** The goal that went out — what the marker and the read-back describe. */
  goal: GoalPose | null;
  taskStatus: TaskStatus | null;
  /** A submitted task that has not reached a terminal state yet. */
  running: boolean;
  /** True while a submit / cancel request is in flight. */
  busy: boolean;
  error: string | null;
  /** Only true while the task id is still known (see the poll effect). */
  cancelable: boolean;
  /**
   * Re-send the pose already on screen. Not a step in the ordinary flow — the
   * drag dispatches — but the only way back from a submit that failed, since by
   * then the gesture that produced the pose is over and there is nothing left to
   * release.
   */
  send: () => Promise<void>;
  /**
   * Stage a pose and dispatch it as a one-step MOVE task. The only door in: both
   * a finished drag and a confirmed double-click on a stored vertex arrive here,
   * so however the pose was chosen there is one running task, one read-back and
   * one Cancel.
   */
  sendGoal: (goal: GoalPose) => Promise<void>;
  cancel: () => Promise<void>;
  clear: () => void;
}

/**
 * The drag-a-goal state machine: dispatch a pose as a one-step MOVE task, then
 * track that task until it is terminal.
 *
 * Firing on pointer-up rather than staging for a Send press is deliberate, and
 * it is the argument the initial-pose flow already makes (see `useInitialPose`):
 * the arrow drawn under the drag *is* the preview, so a confirm step only asks
 * the operator to re-read as numbers what they just aimed by eye — and a button
 * that has to be pressed on every goal stops being read by the tenth one.
 *
 * What keeps a real robot movement deliberate lives upstream instead: the tool
 * has to be armed by an explicit press, one drag disarms it again, and a press
 * outside the map extent never becomes a pose at all. And a goal, unlike a pose
 * estimate, is recoverable after the fact — Cancel stops the robot, which is a
 * better answer to a misplaced goal than a pre-flight read-back would have been.
 *
 * Which drag the viewport is currently collecting is NOT owned here: a goal and
 * an initial-pose estimate are two things one drag gesture can produce, and only
 * one of them can be armed at a time. The view owns that single pick mode (see
 * PointCloudView) and hands the finished pose to whichever flow asked for it.
 *
 * Two mutations and a tracker: the requests own their own in-flight and failure
 * state, useTaskTracker owns everything about the task once it has an id.
 *
 * Their three error slots are read in a deliberate order. A failed submit wins
 * because there is then no task to report on at all. The *task's* own failure
 * comes next and outranks a failed cancel: "navigation aborted" is what
 * actually stopped the robot, and a cancel that was refused because the
 * workflow had already closed must not stand in front of the reason it closed.
 */
export function useGoalTask(robotId: string): GoalTask {
  const [goal, setGoal] = React.useState<GoalPose | null>(null);
  const task = useTaskTracker();

  const { track, reset, taskId } = task;

  const submit = useMutation({
    mutationFn: (staged: GoalPose) => sendMoveTask(robotId, staged),
    // Before the request, not after it: the panel shows the new coordinates
    // the moment the drag is released, and the last run's step failure sitting
    // under them would read as this goal's. The button that got here is gated
    // on `running`, so there is never a live poll to fight over the slot.
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
      // Normalised on the way in, not just inside sendMoveTask: the marker and
      // the read-back are drawn from this state, and a heading they disagree
      // with the dispatched task about would be a lie about a moving robot.
      const staged = { ...next, theta: normalizeTheta(next.theta) };
      setGoal(staged);
      // The last cancel's refusal was about a task that is over; a new dispatch
      // is not the place to keep reading it. A previous *submit* failure needs
      // no such call — going pending drops it, and the tracker's is cleared by
      // this mutation's onMutate.
      resetCancel();
      // `staged`, not the `goal` state — setState is not visible until the next
      // render, so reading it back here would submit the previous goal. The
      // rejection is swallowed because callers are wired straight to a pointer
      // handler; the failure is on `error`.
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
    // The goal marker goes with the status: both describe the same finished
    // task, so leaving one on the map without the other is a lie. The two
    // mutations go with them — their errors describe the same finished task.
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
    cancelable: task.cancelable,
    send,
    sendGoal,
    cancel,
    clear,
  };
}
