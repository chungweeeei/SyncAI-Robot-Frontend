"use client";

import * as React from "react";

import { useChargerDetect } from "@/hooks/use-charger-detect";
import type { FloorBand } from "@/lib/map/floors";
import { robotGround } from "@/lib/map/waypoint-ground";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type { Placement } from "@/lib/types/placement";
import type { PlacedPose, PlanarPose } from "@/lib/types/robot";

export interface WaypointPlacement {
  /** The placed pose being named, or null when nothing is. */
  placement: Placement | null;
  /** A press put a new stop down: open it for a name. `charger` is Add charger. */
  begin: (pose: PlacedPose, charger: boolean) => void;
  /** Let go of the placement and of whatever the last look for the charger said. */
  close: () => void;
  /** Replace the pose with where the robot stands now. */
  takeRobotPose: () => void;
  /** Have the robot look for the charger, and take the pose it measures. */
  detectCharger: () => void;
  /** The robot is looking (up to ~8 s). */
  detecting: boolean;
  /** The last look's failure, verbatim, or null. */
  detectError: string | null;
  /** Forget the last look's failure: the line is someone else's from here. */
  clearDetect: () => void;
}

/**
 * A new waypoint between the press that placed it and the name that makes it
 * one, for both places a waypoint is placed — the dashboard, which writes it
 * at once, and the map editor, which stages it for Save. What each does on
 * Create is its own; the pose's three sources are the same and live here:
 * the press (`begin`), where the robot stands (`takeRobotPose`) and, for a
 * charger, where the robot measured it (`detectCharger`).
 *
 * `robotPose` is the robot's pose on `mapName` or null (useRobotMapPose);
 * `voxels` and `bands` are that map's tree and floors, for the ground under
 * the robot.
 */
export function useWaypointPlacement({
  mapName,
  robotPose,
  voxels,
  bands,
}: {
  mapName: string;
  robotPose: (PlanarPose & { z: number }) | null;
  voxels: OccupiedVoxels | null;
  bands: readonly FloorBand[];
}): WaypointPlacement {
  const [placement, setPlacement] = React.useState<Placement | null>(null);
  // Counts placements, so the dialog can tell a new stop from the same one
  // moved onto the robot.
  const seq = React.useRef(0);
  const { busy, error, run, clear } = useChargerDetect(mapName);

  const begin = React.useCallback((pose: PlacedPose, charger: boolean) => {
    seq.current += 1;
    setPlacement({ key: seq.current, pose, charger });
  }, []);

  const close = React.useCallback(() => {
    setPlacement(null);
    clear();
  }, [clear]);

  // A snapshot, not a live binding: a pose that crept while the name was typed
  // would be a stop nobody placed. Same key, so the typed name survives.
  // On the ground under the robot, on the floor its body height is in.
  const takeRobotPose = React.useCallback(() => {
    if (!robotPose) return;
    const z = robotGround(voxels, bands, robotPose);
    const pose = { x: robotPose.x, y: robotPose.y, theta: robotPose.theta, z };
    setPlacement((cur) => (cur ? { ...cur, pose, detected: false } : cur));
    clear();
  }, [robotPose, bands, voxels, clear]);

  // The charger's pose as the robot measured it, z included: that is the
  // ground the robot stands on, not one to look up under the point. Same key,
  // so the name and the type survive; only for the placement that asked, so
  // an answer that outlived its dialog names nothing.
  const key = placement?.key ?? null;
  const detectCharger = React.useCallback(() => {
    if (key === null) return;
    void run().then(({ pose, answered }) => {
      if (!answered) {
        // No answer is coming and there is no sentence to show: let go of
        // the dialog the look was holding.
        setPlacement((cur) => (cur && cur.key === key ? null : cur));
        clear();
        return;
      }
      if (!pose) return;
      // Spread, so a placement from Add charger stays one.
      setPlacement((cur) => (cur && cur.key === key ? { ...cur, pose, detected: true } : cur));
    });
  }, [key, run, clear]);

  return {
    placement,
    begin,
    close,
    takeRobotPose,
    detectCharger,
    detecting: busy,
    detectError: error,
    clearDetect: clear,
  };
}
