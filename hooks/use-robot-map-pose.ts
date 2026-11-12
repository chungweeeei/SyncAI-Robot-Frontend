"use client";

import * as React from "react";

import { useRobotStateSelect } from "@/hooks/use-console-robot-state";
import { useActiveMap } from "@/hooks/use-maps";
import type { PlanarPose, RobotState } from "@/lib/types/robot";

export interface UseRobotMapPose {
  /**
   * Where the robot stands on *this* map, or null when unknowable. `z` is its
   * body height, which says which floor it is on (`floorBands` cuts by it).
   */
  pose: (PlanarPose & { z: number }) | null;
  /** Why `pose` is null, as a sentence for the operator. */
  reason: string | null;
}

/**
 * The robot's pose, only when it is a pose on the map named here — otherwise
 * the same numbers are on a different floor. Every "no" carries a sentence,
 * because the answer feeds a disabled button that must say why.
 *
 * Reads the 1 Hz state poll, not the telemetry socket, for
 * `localization_valid`: the socket cannot say its last frame stopped being
 * true.
 */
function localizedPose(state: RobotState) {
  const { x, y, theta, z } = state.localization_status.position;
  return { valid: state.localization_valid, x, y, theta, z: z ?? 0 };
}

export function useRobotMapPose(name: string): UseRobotMapPose {
  // The fields this answer is made of and nothing else: the frame's
  // timestamp moves every second and would re-render the editor while the
  // robot stands still.
  const fix = useRobotStateSelect(localizedPose);
  const { map: activeMap, status: mapsStatus } = useActiveMap();

  const hasState = fix !== undefined;
  const valid = fix?.valid ?? false;
  const x = fix?.x ?? 0;
  const y = fix?.y ?? 0;
  const theta = fix?.theta ?? 0;
  const z = fix?.z ?? 0;

  const activeName = activeMap?.name ?? null;

  return React.useMemo(() => {
    if (mapsStatus === "loading") {
      return { pose: null, reason: "Checking which map the robot is on." };
    }
    if (activeName === null) {
      return { pose: null, reason: "The robot has no map loaded." };
    }
    if (activeName !== name) {
      return {
        pose: null,
        reason: `The robot is running on "${activeName}", not this map.`,
      };
    }
    if (!hasState) {
      return { pose: null, reason: "No signal from the robot yet." };
    }
    if (!valid) {
      // The pose is a zeroed placeholder here (see RobotState.localization_valid).
      return { pose: null, reason: "The robot does not know where it is yet." };
    }
    return { pose: { x, y, theta, z }, reason: null };
  }, [mapsStatus, activeName, name, hasState, valid, x, y, theta, z]);
}
