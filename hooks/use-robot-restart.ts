"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { restartRobotStack } from "@/lib/api/robot";
import { restartPending } from "@/lib/robot/restart";
import type { RobotMode } from "@/lib/types/robot";

export interface RobotRestart {
  /** The mode the robot last reported, or null before the first state frame. */
  reported: RobotMode | null;
  /** The state poll's health. "error" during a restart is the expected shape. */
  stateStatus: "loading" | "ok" | "error";
  /**
   * Whether a press here can do anything: the link is up and the robot is in
   * Navigation. The backend refuses every other mode, and a press with the
   * link already down would fail in the same way a restart that is working
   * does — a dropped connection — and be shown as one.
   */
  canRestart: boolean;
  /**
   * A restart this console asked for is still under way. Derived from the
   * shared poll, not stored — see lib/robot/restart.ts for why the answer is
   * "the link dropped and came back" rather than anything in the frame.
   */
  pending: boolean;
  /** True while the POST itself is in flight (well before `pending` clears). */
  busy: boolean;
  error: string | null;
  /**
   * Ask for the restart. Resolves false when the robot refused it — the one
   * outcome the caller keeps its dialog open for, to show the sentence — and
   * true for everything else, a dropped connection included. Never rejects.
   */
  restart: () => Promise<boolean>;
  /** Clear a previous refusal, before the dialog opens again. */
  reset: () => void;
}

/**
 * Restart the robot's software in the mode it is already in, and watch it
 * come back.
 *
 * The same two halves as useModeSwitch, whose doc explains them: the request
 * is recorded before it goes out because it usually kills its own responder,
 * and the confirmation channel is the console's 1 Hz state poll rather than
 * the POST. It reads that poll through useConsoleRobotState and starts none
 * of its own.
 */
export function useRobotRestart(): RobotRestart {
  const { state, status, updatedAt, lastErrorAt } = useConsoleRobotState();
  const [requestedAt, setRequestedAt] = React.useState<number | null>(null);

  const reported = state?.mode ?? null;
  const pending = restartPending({ requestedAt, updatedAt, lastErrorAt });

  const request = useMutation({
    mutationFn: () => restartRobotStack(),
    // Recorded before the call: "the POST resolved" is not when the restart
    // began, and the drop that follows has to land after this moment to count.
    onMutate: () => {
      setRequestedAt(Date.now());
    },
    onSuccess: (result) => {
      // Finished inside the backend's ack window: there is no drop to wait for.
      if (!result.restarting) setRequestedAt(null);
    },
    onError: (cause) => {
      // The connection dropped because the restart is tearing the backend
      // down. Expected; the poll reports the return.
      if (cause instanceof TypeError) return;
      // A refusal (409 outside Navigation, 502 with the robot's reason): the
      // restart did not start, so it must not be shown as under way.
      setRequestedAt(null);
    },
  });

  const { mutateAsync: requestRestart, reset } = request;

  const restart = React.useCallback(
    () =>
      requestRestart().then(
        () => true,
        (cause: unknown) => cause instanceof TypeError,
      ),
    [requestRestart],
  );

  return {
    reported,
    stateStatus: status,
    canRestart: status === "ok" && reported === "AUTO",
    pending,
    busy: request.isPending,
    // The forgiven TypeError is a restart in progress on screen, not an error.
    error:
      request.error instanceof TypeError
        ? null
        : (request.error?.message ?? null),
    restart,
    reset,
  };
}
