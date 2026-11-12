"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { refuseIfStopped, useConsoleEstop } from "@/hooks/use-console-estop";
import { useTaskTracker, type TaskTracker } from "@/hooks/use-task-tracker";
import { ignore } from "@/lib/api/mutation-state";
import { mutationKeys } from "@/lib/api/query-keys";
import { cancelTask } from "@/lib/api/task";

export interface TrackedDispatch<Variables> {
  /** The run the last send started, followed until terminal. */
  task: TaskTracker;
  /** Send, then follow the job the backend answers with. Never rejects. */
  submit: (variables: Variables) => Promise<void>;
  /** Cancel the followed run while it can still be canceled. Never rejects. */
  cancel: () => Promise<void>;
  /** Forget the run and both requests' errors, which describe the same job. */
  clear: () => void;
  /** A send or cancel request is in flight. */
  busy: boolean;
  /**
   * A failed send (no job at all), then the job's own failure, then a failed
   * cancel — a cancel refused because the job already closed must not hide
   * why it closed.
   */
  error: string | null;
  /** The send's refusal alone, for a surface with no readback to show it in. */
  refused: string | null;
}

/**
 * What every flow that sends the robot a job and follows it shares: the send
 * (refused while the stop is engaged, keyed `taskDispatch` so the masthead
 * sees a job this tab sent), the tracker it hands the new id to, the cancel
 * and the error order. `useGoalTask` and `useTaskDispatch` differ only in
 * what they send and what they read back, so that is all they hold.
 *
 * `kind` is the job's kind for the masthead's words (`meta`), and `dispatch`
 * answers with the new job's id.
 */
export function useTrackedDispatch<Variables>({
  kind,
  dispatch,
}: {
  kind: string;
  dispatch: (variables: Variables) => Promise<string>;
}): TrackedDispatch<Variables> {
  const task = useTaskTracker();
  const { track, reset, taskId } = task;
  const { engaged: stopped } = useConsoleEstop();

  const send = useMutation({
    mutationKey: mutationKeys.taskDispatch,
    meta: { kind },
    mutationFn: async (variables: Variables) => {
      // Refused here, not only greyed at the button, so no path can send the
      // robot while the stop is engaged.
      refuseIfStopped(stopped);
      return dispatch(variables);
    },
    // Before the request: the last run's failure and readback would read as
    // this one's. Callers are gated on `running`.
    onMutate: () => reset(),
    onSuccess: (id) => track(id),
  });

  const cancelRun = useMutation({
    // No optimistic CANCELED: whether the job stopped is the poll's answer.
    mutationFn: (id: string) => cancelTask(id),
  });

  const { mutateAsync: sendAsync, reset: resetSend } = send;
  const { mutateAsync: cancelAsync, reset: resetCancel } = cancelRun;

  const submit = React.useCallback(
    async (variables: Variables) => {
      // The last cancel's refusal was about a finished job.
      resetCancel();
      await sendAsync(variables).catch(ignore);
    },
    [sendAsync, resetCancel],
  );

  const cancel = React.useCallback(async () => {
    if (!taskId) return;
    await cancelAsync(taskId).catch(ignore);
  }, [taskId, cancelAsync]);

  const clear = React.useCallback(() => {
    reset();
    resetSend();
    resetCancel();
  }, [reset, resetSend, resetCancel]);

  const refused = send.error?.message ?? null;

  return {
    task,
    submit,
    cancel,
    clear,
    busy: send.isPending || cancelRun.isPending,
    error: refused ?? task.error ?? cancelRun.error?.message ?? null,
    refused,
  };
}
