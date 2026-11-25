import { queryOptions, useQuery } from "@tanstack/react-query";

import { queryKeys } from "@/lib/api/query-keys";
import { readStatus } from "@/lib/api/read-state";
import { fetchRobotState, robotStateSilence } from "@/lib/api/robot";
import type { ReadStatus } from "@/lib/types/read";
import type { RobotState } from "@/lib/types/robot";

// RobotState.timestamp has whole-second resolution, so faster than 1 Hz only
// re-fetches an indistinguishable snapshot. Motion comes over the telemetry socket.
const DEFAULT_POLL_MS = 1000;

export type RobotStateStatus = ReadStatus;

/**
 * The entry both the poll and its selectors (use-console-robot-state.ts)
 * observe, so a selector's `queryFn` is the poll's own.
 */
export const robotStateQuery = queryOptions({
  queryKey: queryKeys.robotState,
  queryFn: ({ signal }) => fetchRobotState(signal),
});

export interface UseRobotState {
  /** Null before the first success. */
  state: RobotState | null;
  /**
   * On an error the last good `state` is kept — as a memory, not a reading:
   * the robot id, the map and the pose are still worth showing, but what the
   * robot would do with a job (`state.state`) is only known while this is
   * "ok" (lib/robot/readiness.ts's stateReading).
   */
  status: RobotStateStatus;
  /**
   * The backend's sentence when the read fails because the robot is not
   * reporting its state ("The robot has not reported its state for 4
   * seconds."); null on a healthy poll and for any other failure, whose
   * message is not written for an operator.
   */
  silence: string | null;
  /**
   * Client clock (ms) at the last successful fetch. Moves on every frame even
   * when structural sharing keeps `state` the same object, which is what the
   * status strip's 1 Hz sweep needs.
   */
  updatedAt: number | null;
}

/**
 * Polls GET /api/v1/robot/state. It 404s until the robot publishes its first
 * state, which reads as "error" with state still null — and again once the
 * robot stops publishing, which reads as "error" over the last good frame.
 * The poll goes on through either, so the status mends itself.
 */
export function useRobotState(pollMs: number = DEFAULT_POLL_MS): UseRobotState {
  const query = useQuery({ ...robotStateQuery, refetchInterval: pollMs });
  const { data, dataUpdatedAt, error } = query;

  return {
    state: data ?? null,
    status: readStatus(query),
    silence: robotStateSilence(error),
    updatedAt: dataUpdatedAt || null,
  };
}
