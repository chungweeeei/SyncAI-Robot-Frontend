"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { ESTOP_REFUSAL, useConsoleEstop } from "@/hooks/use-console-estop";
import { useTaskTracker } from "@/hooks/use-task-tracker";
import { ignore } from "@/lib/api/mutation-state";
import { sendPostureTask, type Posture } from "@/lib/api/task";

export interface PostureControl {
  send: (posture: Posture) => Promise<void>;
  /** The command whose task is being tracked. */
  sent: Posture | null;
  running: boolean;
  busy: boolean;
  error: string | null;
}

/**
 * Stand up / lie down, each a one-step posture task. One click: the button
 * fully describes the command. No cancel: the motion key has been acted on by
 * the time the workflow reports, so the way back is the opposite posture.
 */
export function usePosture(robotId: string): PostureControl {
  const task = useTaskTracker();
  const { track, reset } = task;
  const { engaged: stopped } = useConsoleEstop();

  const submit = useMutation({
    mutationFn: async (posture: Posture) => {
      // Refused here as well as greyed at the button: see useGoalTask.
      if (stopped) throw new Error(ESTOP_REFUSAL);
      return sendPostureTask(robotId, posture);
    },
    // Before the request, or the previous failure would read as this command's.
    onMutate: () => reset(),
    onSuccess: (id) => track(id),
  });

  const { mutateAsync: submitAsync } = submit;

  const send = React.useCallback(
    async (posture: Posture) => {
      await submitAsync(posture).catch(ignore);
    },
    [submitAsync],
  );

  return {
    send,
    // Set as the request goes out, so a failed submit is still named by its error.
    sent: submit.variables ?? null,
    running: task.running,
    busy: submit.isPending,
    error: submit.error?.message ?? task.error,
  };
}
