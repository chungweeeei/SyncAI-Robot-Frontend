"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { cancelTask } from "@/lib/api/task";

/**
 * DELETE /api/v1/tasks/{id} — ask Temporal to cancel a run.
 *
 * Cancelling is a request, and the workflow stops when it stops. The active
 * list is re-read rather than the row dropped locally, so the row disappearing
 * on the next poll is the honest signal that it did. (The composer's own run
 * goes through useTaskDispatch, which follows it at 1 Hz; this is for runs this
 * tab did not start.)
 */
export function useCancelTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => cancelTask(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
    },
  });
}
