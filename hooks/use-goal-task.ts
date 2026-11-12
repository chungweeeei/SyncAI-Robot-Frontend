"use client";

import * as React from "react";
import { useTrackedDispatch } from "@/hooks/use-tracked-dispatch";
import { normalizeTheta } from "@/lib/angle";
import { sendMoveTask, type GoalPose, type TaskStatus } from "@/lib/api/task";
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
 * The send, the tracking, the cancel and the error order are
 * useTrackedDispatch's, shared with useTaskDispatch.
 */
export function useGoalTask(robotId: string, mapName: string | null): GoalTask {
  const [goal, setGoal] = React.useState<GoalPose | null>(null);

  const { task, submit, cancel, clear: clearRun, busy, error } = useTrackedDispatch({
    kind: "goal",
    // The map travels with the goal, so the backend refuses it if the robot
    // has switched maps since it was aimed.
    dispatch: (staged: GoalPose) => sendMoveTask(robotId, staged, mapName),
  });

  const sendGoal = React.useCallback(
    async (next: GoalPose) => {
      // Normalised here too, so the marker and read-back agree with the
      // dispatched heading.
      const staged = { ...next, theta: normalizeTheta(next.theta) };
      setGoal(staged);
      // `staged`, not `goal`: setState is not visible until the next render.
      await submit(staged);
    },
    [submit],
  );

  const send = React.useCallback(async () => {
    if (!goal) return;
    await sendGoal(goal);
  }, [goal, sendGoal]);

  const clear = React.useCallback(() => {
    // Marker, status and both requests' errors describe the same finished task.
    setGoal(null);
    clearRun();
  }, [clearRun]);

  // A goal reached is cleared on arrival: there is nothing left to retry or
  // read back, and a Clear owed on every success stops being pressed. Derived
  // rather than cleared in an effect, so the read that closed the run is the
  // one that drops the marker. A failed or canceled goal stays for its Retry.
  if (task.taskStatus === "COMPLETED") {
    return {
      goal: null,
      taskStatus: null,
      running: false,
      busy,
      error: null,
      message: "",
      cancelable: false,
      send,
      sendGoal,
      cancel,
      clear,
    };
  }

  return {
    goal,
    taskStatus: task.taskStatus,
    running: task.running,
    busy,
    error,
    message: currentStep(task.steps)?.step.message ?? "",
    cancelable: task.cancelable,
    send,
    sendGoal,
    cancel,
    clear,
  };
}
