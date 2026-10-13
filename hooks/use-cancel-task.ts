"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { cancelTask } from "@/lib/api/task";

/**
 * DELETE /api/v1/tasks/{id} — cancel a run this tab did not start. A request:
 * the active list is re-read rather than the row dropped, so its disappearing
 * is the honest signal that it stopped.
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
