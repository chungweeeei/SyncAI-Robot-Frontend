"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { setSafetyLock } from "@/lib/api/robot";

/**
 * POST /api/v1/robot/estop — engage or release the safety lock (one switch,
 * one mutation).
 *
 * The answer only echoes the request; the lock's state is
 * `low_level_mode.safety_locked`, invalidated so it catches up at once. An
 * engage also cancels every running job, so the active list is re-read too.
 */
export function useEstop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (locked: boolean) => setSafetyLock(locked),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.robotState });
      if (result.cancel_requested) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
      }
    },
  });
}
