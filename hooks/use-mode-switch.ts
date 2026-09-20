"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { ignore } from "@/lib/api/mutation-state";
import { switchRobotMode, type SwitchableMode } from "@/lib/api/mapping";
import type { RobotMode } from "@/lib/types/robot";

export interface ModeSwitch {
  /**
   * The mode the robot last reported, or null before the first state frame.
   * During a switch this is the *old* mode held by the query cache — the
   * backend is down and the poll is erroring — until the rebuilt stack's
   * robot_state answers with the new one.
   */
  reported: RobotMode | null;
  /** The state poll's health. "error" during a switch is the expected shape. */
  stateStatus: "loading" | "ok" | "error";
  /**
   * The mode a switch is in flight towards, or null. Derived, not stored: the
   * moment a state frame reports the requested mode this is null again, so it
   * resolves itself with no effect to clear it — the same shape as
   * useLocomotion's pendingPolicy.
   */
  pending: SwitchableMode | null;
  /** True while the POST itself is in flight (well before `pending` clears). */
  busy: boolean;
  error: string | null;
  switchTo: (mode: SwitchableMode) => Promise<void>;
}

/**
 * Command the operating mode and watch it land.
 *
 * **The confirmation channel is the robot state poll, not the POST.** A real
 * switch tears down the byobu session the backend runs in, so the POST's
 * connection usually just drops — and that is the switch *working*. The two
 * halves of this hook reflect that: the request is recorded before it goes out
 * and its network error is forgiven, and `pending` compares the request against
 * what `RobotState.mode` (fed by sys_manager's get_mode) actually reports,
 * across the 10–30 s hole while the stack rebuilds.
 *
 * Reads the console's shared 1 Hz poll via useConsoleRobotState rather than
 * running its own — the cache holding the last good frame through the outage
 * is also what keeps `reported` meaningful while the API is down.
 */
export function useModeSwitch(): ModeSwitch {
  const { state, status } = useConsoleRobotState();
  const [requested, setRequested] = React.useState<SwitchableMode | null>(null);

  const reported = state?.mode ?? null;

  // Derived, not stored — see the interface doc. Also self-corrects the case
  // where the switch was requested from another console: whatever we asked for
  // stops pending the moment the robot reports it, however it got there.
  const pending = requested && requested !== reported ? requested : null;

  const request = useMutation({
    mutationFn: (next: SwitchableMode) => switchRobotMode(next),
    // Recorded before the call, not after: the request usually kills its own
    // responder, so "the POST resolved" is not the moment the switch began.
    onMutate: (next) => {
      setRequested(next);
    },
    // A resolved POST is either the no-op (already in `next`, in which case
    // `pending` is already null) or a dispatch that answered inside the
    // backend's ack window. Nothing to do for either.
    onError: (cause) => {
      // fetch's network-level failure: the connection dropped because the
      // switch is tearing the backend down. Expected; the state poll will
      // report the landing, so the request stays pending.
      if (cause instanceof TypeError) return;
      // An HTTP-level refusal (502 with sys_manager's reason, a 422): the
      // switch did not start, so it must not be shown as pending.
      setRequested(null);
    },
  });

  const { mutateAsync: requestMode } = request;

  const switchTo = React.useCallback(
    async (next: SwitchableMode) => {
      await requestMode(next).catch(ignore);
    },
    [requestMode],
  );

  return {
    reported,
    stateStatus: status,
    pending,
    busy: request.isPending,
    // The forgiven TypeError is still an error on the mutation; it is a switch
    // in progress on screen, so it is filtered out here rather than left to
    // every caller to recognise.
    error: isDroppedConnection(request.error) ? null : (request.error?.message ?? null),
    switchTo,
  };
}

/** fetch's network-level failure, which for this request means "in progress". */
function isDroppedConnection(error: Error | null): boolean {
  return error instanceof TypeError;
}
