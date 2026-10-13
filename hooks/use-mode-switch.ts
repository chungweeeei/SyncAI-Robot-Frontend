"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { ignore } from "@/lib/api/mutation-state";
import { switchRobotMode, type SwitchableMode } from "@/lib/api/mapping";
import type { RobotMode } from "@/lib/types/robot";

export interface ModeSwitch {
  /**
   * The last reported mode. During a switch the cache holds the *old* one
   * while the backend is down, until the rebuilt stack answers.
   */
  reported: RobotMode | null;
  /** "error" during a switch is the expected shape. */
  stateStatus: "loading" | "ok" | "error";
  /**
   * The mode a switch is heading for. Derived: null the moment a frame
   * reports it, as with useLocomotion's pendingPolicy.
   */
  pending: SwitchableMode | null;
  /** The POST is in flight (well before `pending` clears). */
  busy: boolean;
  error: string | null;
  switchTo: (mode: SwitchableMode) => Promise<void>;
}

/**
 * Command the operating mode and watch it land.
 *
 * **The confirmation channel is the robot state poll, not the POST.** A switch
 * tears down the session the backend runs in, so the POST usually just drops
 * — the switch *working*. The request is recorded before it goes out, its
 * network error is forgiven, and `pending` reads against `RobotState.mode`
 * across the 10–30 s rebuild.
 */
export function useModeSwitch(): ModeSwitch {
  const { state, status } = useConsoleRobotState();
  const [requested, setRequested] = React.useState<SwitchableMode | null>(null);

  const reported = state?.mode ?? null;

  // Derived, so it also settles however the robot got there.
  const pending = requested && requested !== reported ? requested : null;

  const request = useMutation({
    mutationFn: (next: SwitchableMode) => switchRobotMode(next),
    // Before the call: the request usually kills its own responder.
    onMutate: (next) => {
      setRequested(next);
    },
    onError: (cause) => {
      // A dropped connection is the switch tearing the backend down; stay pending.
      if (cause instanceof TypeError) return;
      // An HTTP refusal (502, 422): the switch did not start.
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
    // The forgiven TypeError is a switch in progress, filtered here once.
    error: isDroppedConnection(request.error) ? null : (request.error?.message ?? null),
    switchTo,
  };
}

/** A network-level failure, which for this request means "in progress". */
function isDroppedConnection(error: Error | null): boolean {
  return error instanceof TypeError;
}
