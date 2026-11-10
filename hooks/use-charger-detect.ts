"use client";

import * as React from "react";
import { useMutation } from "@tanstack/react-query";

import {
  ChargerDetectError,
  ChargerDetectNoResponseError,
  detectCharger,
  type ChargerDetectCode,
} from "@/lib/api/landmark";
import type { PlacedPose } from "@/lib/types/robot";

export interface ChargerDetectOutcome {
  /** The charger's pose, or null when there is none to use. */
  pose: PlacedPose | null;
  /**
   * False when the robot never answered (unreachable, or the wait ran out):
   * there is no sentence to show, so the caller closes what it held open.
   */
  answered: boolean;
}

export interface ChargerDetect {
  /** The robot is looking (up to ~8 s). */
  busy: boolean;
  /** The last attempt's failure, or null. Rendered verbatim. */
  error: string | null;
  /** The backend's reason for that failure, where it named one. */
  code: ChargerDetectCode | null;
  /** Never rejects: a refusal is `error`, a robot that did not answer `answered`. */
  run: () => Promise<ChargerDetectOutcome>;
  clear: () => void;
}

/**
 * Ask the robot to find the charger with its camera, for a waypoint being
 * placed on `mapName`. A command, so it invalidates nothing: the answer is a
 * measurement, and the caller puts it in its own draft.
 *
 * The answer names the map it was measured on. One for another map is a
 * failure here rather than a pose: the same numbers there are somewhere else.
 */
export function useChargerDetect(mapName: string): ChargerDetect {
  const mutation = useMutation({
    mutationFn: async (): Promise<PlacedPose> => {
      const found = await detectCharger();
      if (found.map !== mapName) {
        throw new Error(
          `The robot found the charger on "${found.map}", not on this map, so its position was not used.`,
        );
      }
      // `z` as measured: it is the ground the robot stands on.
      return { x: found.x, y: found.y, z: found.z, theta: found.theta };
    },
  });
  const { mutateAsync, reset } = mutation;

  const run = React.useCallback(
    () =>
      mutateAsync().then(
        (pose): ChargerDetectOutcome => ({ pose, answered: true }),
        (error: unknown): ChargerDetectOutcome => ({
          pose: null,
          answered: !(error instanceof ChargerDetectNoResponseError),
        }),
      ),
    [mutateAsync],
  );

  return {
    busy: mutation.isPending,
    error: mutation.error?.message ?? null,
    code: mutation.error instanceof ChargerDetectError ? mutation.error.code : null,
    run,
    clear: reset,
  };
}
