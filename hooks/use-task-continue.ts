"use client";

import { useMutation } from "@tanstack/react-query";

import { ESTOP_REFUSAL, useConsoleEstop } from "@/hooks/use-console-estop";
import { mutationKeys } from "@/lib/api/query-keys";
import { continueTask, type TaskKind } from "@/lib/api/task";

/**
 * POST /api/v1/tasks with `continue_from` — run a FAILED job again from the
 * step it failed at, as a new job. A command, like useTaskDispatch's send: it
 * invalidates nothing, and is keyed `taskDispatch` so the masthead follows
 * the new job as one this tab sent (useActiveRun). `kind` (lib/task/history.ts's
 * `continuationKind`) and `name` ride in the variables for the masthead's
 * words; only the kind is sent.
 */
export function useTaskContinue() {
  const { engaged: stopped } = useConsoleEstop();
  return useMutation({
    mutationKey: mutationKeys.taskDispatch,
    mutationFn: async ({
      robot,
      failedId,
      kind,
    }: {
      robot: string;
      failedId: string;
      kind: TaskKind;
      name: string | null;
    }) => {
      // Refused here as well as greyed at the button: see useGoalTask.
      if (stopped) throw new Error(ESTOP_REFUSAL);
      return continueTask(robot, failedId, kind);
    },
  });
}
