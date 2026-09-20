"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useTaskTracker } from "@/hooks/use-task-tracker";
import { ignore } from "@/lib/api/mutation-state";
import { sendPostureTask, type Posture, type TaskStatus } from "@/lib/api/task";

export interface PostureControl {
  /** Submit a posture command. */
  send: (posture: Posture) => Promise<void>;
  /** The command whose task is being tracked, or null. */
  sent: Posture | null;
  taskStatus: TaskStatus | null;
  running: boolean;
  /** True while the submit request itself is in flight. */
  busy: boolean;
  error: string | null;
  clear: () => void;
}

/**
 * Stand up / lie down, each submitted as a one-step posture task.
 *
 * One click, no confirmation step: unlike a nav goal there is nothing staged to
 * read back — the command is fully described by the button that was pressed,
 * and the operator standing next to the robot is the one pressing it.
 *
 * There is no cancel either: the backend turns each of these into a single
 * motion key that the gait controller has already acted on by the time the
 * workflow reports, so a cancel button would suggest a reversal the stack
 * cannot do. Sending the opposite posture is the way back.
 */
export function usePosture(robotId: string): PostureControl {
  const task = useTaskTracker();
  const { track, reset } = task;

  const submit = useMutation({
    mutationFn: (posture: Posture) => sendPostureTask(robotId, posture),
    // Before the request, not after it: `sent` names the new command as soon as
    // it goes out, and the previous one's step failure under that name would
    // read as this command's. The buttons are gated on `running`, so there is
    // never a live poll to fight over the slot.
    onMutate: () => reset(),
    onSuccess: (id) => track(id),
  });

  const { mutateAsync: submitAsync, reset: resetSubmit } = submit;

  const send = React.useCallback(
    async (posture: Posture) => {
      // Swallowed because the button is wired straight to this; the failure is
      // on `error`.
      await submitAsync(posture).catch(ignore);
    },
    [submitAsync],
  );

  const clear = React.useCallback(() => {
    resetSubmit();
    reset();
  }, [reset, resetSubmit]);

  return {
    send,
    // The mutation's own variables, which is what "the command being tracked"
    // has always meant here: it is set the moment the request goes out, so a
    // posture that failed to submit is still the one named beside the error.
    sent: submit.variables ?? null,
    taskStatus: task.taskStatus,
    running: task.running,
    busy: submit.isPending,
    error: submit.error?.message ?? task.error,
    clear,
  };
}
