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
  /** The mode the robot last reported, or null before the first state frame. */
  reported: RobotMode | null;
  /** The state poll's health. */
  stateStatus: "loading" | "ok" | "error";
  /**
   * Whether a press here can do anything: the link is up, the robot is in
   * Navigation (the backend refuses every other mode), and no restart is
   * already under way.
   */
  canRestart: boolean;
  /**
   * A restart is under way, whichever console asked for it — the backend's
   * own record says so, not anything this tab remembers.
   */
  pending: boolean;
  /**
   * How the restart this tab asked for ended, once it has. Null before, and
   * for a restart some other console started: that operator is the one
   * waiting on the answer.
   */
  outcome: Pick<RestartRecord, "status" | "message"> | null;
  /** True while the POST itself is in flight (well before `pending` clears). */
  busy: boolean;
  /** The backend's refusal of the POST, verbatim. */
  error: string | null;
  /**
   * Ask for the restart. Resolves false when it was refused — the one outcome
   * the caller keeps its dialog open for, to show the sentence. Never rejects.
   */
  restart: () => Promise<boolean>;
  /** Clear a previous refusal, before the dialog opens again. */
  reset: () => void;
}

/**
 * Restart the robot's software in the mode it is already in, and report how
 * it ended.
 *
 * The confirmation channel is GET /api/v1/robot/restart, not the robot-state
 * poll: the backend keeps answering throughout (it is not part of the stack
 * being rebuilt) and keeps serving the last state frame, so that poll never
 * notices. The restart record is read once on mount and polled only while it
 * says `restarting` — the backend is changing it on its own then, and the
 * status that started the poll is what stops it.
 */
export function useRobotRestart(): RobotRestart {
  const queryClient = useQueryClient();
  const { state, status } = useConsoleRobotState();
  // Whether this tab pressed Restart, so the outcome is shown to the operator
  // who asked for it and not to every console that happens to be on Settings.
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
      // Written before `asked` is read: until the refetch below lands, the
      // cache still holds the *previous* restart's record, and this tab would
      // otherwise announce that one's outcome as the answer to this press.
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
      // The backend's own record, which is also what starts the poll. Not
      // awaited.
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
