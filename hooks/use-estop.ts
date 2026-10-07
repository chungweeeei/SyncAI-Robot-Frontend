"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { setMotionKey } from "@/lib/api/robot";
import { cancelTask } from "@/lib/api/task";

export interface EstopResult {
  /**
   * The robot's side accepted the stop and did not forward it to the motors,
   * which is what the backend does with key "4" today. The console must then
   * say the job and the drive were stopped, not that the motors were. False
   * when the key was forwarded, and when it was refused outright — that one is
   * in `refusals`.
   */
  held: boolean;
  /** The backend's own sentences for whatever it refused, verbatim. */
  refusals: string[];
}

/**
 * The emergency stop's one press: the motion key, and a cancel for every job
 * the active list names.
 *
 * All of them go out at once and none waits on another — a cancel held behind
 * a motion key that is slow to answer would be a stop that arrives late — and
 * one refusal does not stop the rest, so `allSettled` and not `all`. Every job
 * listed is cancelled rather than the first one the masthead follows, because
 * a transient second entry is still something moving.
 *
 * It resolves even when something was refused: the stop has been asked for,
 * and the refusals are reported beside it rather than in place of it, which
 * is also why there is never a Retry here — pressing the button again is the
 * retry, and it is the same press.
 *
 * Invalidates the active list for the cancels' sake, as useCancelTask does: the
 * rows leaving on the next read is the honest sign that they stopped.
 */
export function useEstop() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (taskIds: readonly string[]): Promise<EstopResult> => {
      const [[motion], cancels] = await Promise.all([
        Promise.allSettled([setMotionKey("4")]),
        Promise.allSettled(taskIds.map((id) => cancelTask(id))),
      ]);
      const refusals = [motion, ...cancels].flatMap((settled) =>
        settled.status === "rejected" ? [reasonOf(settled.reason)] : [],
      );
      return {
        held: motion.status === "fulfilled" && !motion.value.sent,
        refusals,
      };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.activeTasks });
    },
  });
}

function reasonOf(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
