"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { ESTOP_REFUSAL, useConsoleEstop } from "@/hooks/use-console-estop";
import { useConsoleRobotState } from "@/hooks/use-console-robot-state";
import { ignore } from "@/lib/api/mutation-state";
import { setMotionKey, type MotionKey } from "@/lib/api/robot";
import type { Posture } from "@/lib/api/task";

const POSTURE_KEY: Record<Posture, MotionKey> = {
  STANDUP: "0",
  LIEDOWN: "2",
};

/** The `low_level_mode.motion` label each posture arrives at. */
const POSTURE_MOTION: Record<Posture, string> = {
  STANDUP: "STAND",
  LIEDOWN: "LIE_DOWN",
};

export interface PostureControl {
  send: (posture: Posture) => Promise<void>;
  /** The posture to light: a pending request, else the reported one. */
  posture: Posture | null;
  /** A sent posture the robot has not reported yet; shown as unconfirmed. */
  pending: Posture | null;
  busy: boolean;
  error: string | null;
}

function reportedPosture(motion: string | null): Posture | null {
  if (motion === POSTURE_MOTION.STANDUP) return "STANDUP";
  if (motion === POSTURE_MOTION.LIEDOWN) return "LIEDOWN";
  return null;
}

/**
 * Stand up / lie down, sent as motion keys straight to the driver
 * (`set_motion_key`), not as posture tasks: a task is refused while any other
 * runs, and the operator must be able to stand or lie the robot down during
 * any job. Deliberately not gated on running jobs, even one that drives; the
 * stop is the only lock, here and on the driver.
 *
 * Epistemics as in use-locomotion.ts: the POST returns once a UDP datagram is
 * written, so the lit posture is the reported `motion`, and a request the
 * robot has not reached yet is `pending` — cleared on the frame that reports
 * it, and left pending if none ever does. No cancel: the way back is the
 * opposite posture, which a pending request does not lock out.
 */
export function usePosture(): PostureControl {
  const { engaged: stopped } = useConsoleEstop();
  const motion = useConsoleRobotState().state?.low_level_mode.motion ?? null;

  const reported = reportedPosture(motion);
  const [requested, setRequested] = React.useState<Posture | null>(null);
  // Dropped at render time once a frame confirms, so a later stand-to-lie by
  // someone else does not re-light an old request.
  if (requested !== null && requested === reported) setRequested(null);

  const submit = useMutation({
    mutationFn: async (posture: Posture) => {
      // Refused here as well as greyed at the button: see useGoalTask.
      if (stopped) throw new Error(ESTOP_REFUSAL);
      const result = await setMotionKey(POSTURE_KEY[posture]);
      // Always sent for these keys; honoured so a refusal never looks applied.
      if (!result.sent) throw new Error(result.message);
      return posture;
    },
    onSuccess: (posture) => setRequested(posture),
  });

  const { mutateAsync: submitAsync } = submit;

  const send = React.useCallback(
    async (posture: Posture) => {
      await submitAsync(posture).catch(ignore);
    },
    [submitAsync],
  );

  return {
    send,
    posture: requested ?? reported,
    pending: requested,
    busy: submit.isPending,
    error: submit.error?.message ?? null,
  };
}
