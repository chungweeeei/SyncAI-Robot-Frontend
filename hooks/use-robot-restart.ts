"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { queryKeys } from "@/lib/api/query-keys";
import { fetchRestartStatus, restartRobotStack } from "@/lib/api/robot";
import type { RestartRecord } from "@/lib/api/robot";
import type { RobotMode } from "@/lib/types/robot";

// The rebuild takes about 30 s; a second's resolution on its end is plenty.
const RESTART_POLL_MS = 1000;

export interface RobotRestart {
  reported: RobotMode | null;
  stateStatus: "loading" | "ok" | "error";
  /** Link up, in Navigation (the backend refuses other modes), none under way. */
  canRestart: boolean;
  /** A restart is under way, whichever console asked — the backend's record. */
  pending: boolean;
  /**
   * How the restart *this tab* asked for ended; null for one another console
   * started, whose operator is the one waiting.
   */
  outcome: Pick<RestartRecord, "status" | "message"> | null;
  /** The POST is in flight (well before `pending` clears). */
  busy: boolean;
  error: string | null;
  /** Resolves false when refused, so the dialog stays open. Never rejects. */
  restart: () => Promise<boolean>;
  reset: () => void;
}

/**
 * Restart the robot's software in its current mode, and report how it ended.
 *
 * Confirmed by GET /api/v1/robot/restart, not the state poll: the backend is
 * not part of the rebuilt stack and keeps serving the last frame, so that poll
 * never notices. The record is polled only while it says `restarting`.
 */
export function useRobotRestart(): RobotRestart {
  const queryClient = useQueryClient();
  const { state, status } = useConsoleRobotState();
  // Whether this tab pressed Restart, so only its operator sees the outcome.
  const [asked, setAsked] = React.useState(false);

  const record = useQuery({
    queryKey: queryKeys.robotRestart,
    queryFn: ({ signal }) => fetchRestartStatus(signal),
    refetchInterval: (query) =>
      query.state.data?.status === "restarting" ? RESTART_POLL_MS : false,
  });

  const request = useMutation({
    mutationFn: () => restartRobotStack(),
    onMutate: () => {
      setAsked(false);
    },
    onSuccess: (result) => {
      // Written before `asked` flips, or the cache's *previous* record would be
      // announced as this press's outcome.
      const now = new Date().toISOString();
      queryClient.setQueryData<RestartRecord>(
        queryKeys.robotRestart,
        result.restarting
          ? { status: "restarting", message: "", started_at: now, finished_at: null }
          : {
              status: "succeeded",
              message: result.message,
              started_at: now,
              finished_at: now,
            },
      );
      setAsked(true);
      // The backend's own record, which also starts the poll.
      void queryClient.invalidateQueries({ queryKey: queryKeys.robotRestart });
    },
  });

  const { mutateAsync: requestRestart, reset } = request;

  const restart = React.useCallback(
    () =>
      requestRestart().then(
        () => true,
        () => false,
      ),
    [requestRestart],
  );

  const reported = state?.mode ?? null;
  const current = record.data ?? null;
  const pending = current?.status === "restarting";
  const finished =
    current?.status === "succeeded" || current?.status === "failed";

  return {
    reported,
    stateStatus: status,
    canRestart: status === "ok" && reported === "AUTO" && !pending,
    pending,
    outcome:
      asked && finished && current
        ? { status: current.status, message: current.message }
        : null,
    busy: request.isPending,
    error: request.error?.message ?? null,
    restart,
    reset,
  };
}
