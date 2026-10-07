"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { setSafetyLock } from "@/lib/api/robot";

/**
 * POST /api/v1/robot/estop — engage or release the driver's safety lock.
 *
 * One mutation for both directions, because they are one switch and the
 * console never sends them at once: the button engages, a held press on the
 * same button releases.
 *
 * The answer echoes the request, so it is not what the console shows. What
 * the lock is doing is `low_level_mode.safety_locked` on the shared robot
 * state, and that read is invalidated here so the reading catches up on the
 * next round trip rather than on the next 1 Hz tick. When the request engaged
 * the lock, the backend has also started cancelling every running job, so the
 * active list goes too — the rows leaving it is the honest sign they stopped.
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
