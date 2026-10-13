import { useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { fetchRobotState } from "@/lib/api/robot";
import type { RobotState } from "@/lib/types/robot";

// RobotState.timestamp has whole-second resolution, so faster than 1 Hz only
// re-fetches an indistinguishable snapshot. Motion comes over the telemetry socket.
const DEFAULT_POLL_MS = 1000;

export type RobotStateStatus = "loading" | "ok" | "error";

export interface UseRobotState {
  /** Null before the first success. */
  state: RobotState | null;
  /** On a transient error the last good `state` is kept. */
  status: RobotStateStatus;
  /**
   * Client clock (ms) at the last successful fetch. Moves on every frame even
   * when structural sharing keeps `state` the same object, which is what the
   * status strip's 1 Hz sweep needs.
   */
  updatedAt: number | null;
}

/**
 * Polls GET /api/v1/robot/state. It 404s until the robot publishes its first
 * state, which reads as "error" with state still null.
 */
export function useRobotState(pollMs: number = DEFAULT_POLL_MS): UseRobotState {
  const { data, dataUpdatedAt, isPending, isError } = useQuery({
    queryKey: queryKeys.robotState,
    queryFn: ({ signal }) => fetchRobotState(signal),
    refetchInterval: pollMs,
  });

  return {
    state: data ?? null,
    status: isPending ? "loading" : isError ? "error" : "ok",
    updatedAt: dataUpdatedAt || null,
  };
}
