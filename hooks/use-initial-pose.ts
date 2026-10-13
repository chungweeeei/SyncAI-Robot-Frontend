"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import { ignore } from "@/lib/api/mutation-state";
import { setInitialPose } from "@/lib/api/robot";
import { normalizeTheta } from "@/lib/angle";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * How long a published estimate stays on screen. Short on purpose: 5 s had
 * operators reaching for Clear, and whether the seed took is answered by the
 * robot snapping to the marker, not by this panel.
 */
const CLEAR_AFTER_PUBLISH_MS = 1500;

export interface InitialPoseEstimate {
  /** The last drag's pose, sent on release and cleared shortly after it lands. */
  pose: PlanarPose | null;
  /** Stages *and* sends a pose from a finished drag. */
  commitPose: (pose: PlanarPose) => void;
  published: boolean;
  busy: boolean;
  error: string | null;
  /** Re-send the pose already placed — a retry, not the normal path. */
  publish: () => Promise<void>;
  clear: () => void;
}

/**
 * The drag-an-initial-pose flow (RViz's "2D Pose Estimate"): the pose goes to
 * the localizer on release, with no confirm step — the model on the floor
 * already shows what would be sent, and a mis-drag is fixed by dragging again.
 *
 * `initialpose` has no ack, so `published` means only "sent"; whether it took
 * shows as the pose feed moving. With nothing to wait for, the estimate
 * expires on its own. `published` is the mutation's success, so a fresh drag
 * (going pending) cancels the pending expiry for free.
 */
export function useInitialPose(): InitialPoseEstimate {
  const [pose, setPose] = React.useState<PlanarPose | null>(null);

  const publishPose = useMutation({
    mutationFn: (next: PlanarPose) => setInitialPose(next),
  });

  const {
    mutate: sendPose,
    mutateAsync: sendPoseAsync,
    reset: resetPublish,
    isSuccess: published,
  } = publishPose;

  const commitPose = React.useCallback(
    (next: PlanarPose) => {
      const placed = { ...next, theta: normalizeTheta(next.theta) };
      setPose(placed);
      // `placed`, not `pose`: state set above is not visible in this tick.
      sendPose(placed);
    },
    [sendPose],
  );

  /**
   * A published estimate clears itself: there is no terminal state, and a
   * lingering panel makes a finished action look open. A failure is kept,
   * because the pose is what Retry re-sends.
   */
  React.useEffect(() => {
    if (!published) return;
    const timer = setTimeout(() => {
      setPose(null);
      resetPublish();
    }, CLEAR_AFTER_PUBLISH_MS);
    return () => clearTimeout(timer);
  }, [published, resetPublish]);

  const publish = React.useCallback(async () => {
    if (!pose) return;
    await sendPoseAsync(pose).catch(ignore);
  }, [pose, sendPoseAsync]);

  const clear = React.useCallback(() => {
    setPose(null);
    resetPublish();
  }, [resetPublish]);

  return {
    pose,
    commitPose,
    published,
    busy: publishPose.isPending,
    error: publishPose.error?.message ?? null,
    publish,
    clear,
  };
}
