"use client";

import * as React from "react";

import { createTelemetryStream } from "@/lib/ros/telemetry-stream";
import type { LocalCostmap, PlannedPath, RobotPose } from "@/lib/types/robot";

/**
 * Pose, joints and the robot's local picture as refs, read once per drawn
 * frame. Each message is a fresh object, so a 60 Hz draw loop tells a new
 * frame by identity. The object is stable for the hook's lifetime.
 */
export interface TelemetryFeed {
  /** Map-frame pose. */
  readonly pose: React.RefObject<RobotPose | undefined>;
  /** Joint angles in radians, by URDF name. */
  readonly joints: React.RefObject<Record<string, number> | undefined>;
  /**
   * The costmap the controller steers on, while a navigation runs; `width` 0
   * once it ends. A ref, not state: only the render loop reads it.
   */
  readonly localCostmap: React.RefObject<LocalCostmap | undefined>;
  /** The next 2 s the robot means to drive; empty once it ends. */
  readonly localPlan: React.RefObject<PlannedPath | undefined>;
}

export interface Telemetry {
  feed: TelemetryFeed;
  /**
   * The planner's route. An empty `points` arrives when the run ends — the
   * clear is sent, not inferred from silence (see the backend's get_path).
   */
  path: PlannedPath | undefined;
  /**
   * A dock's final approach, from the robot to the dock (2 Hz while it
   * drives). Empty `points` when the dock goal ends, however it ends.
   */
  dockPath: PlannedPath | undefined;
}

/**
 * The telemetry WebSocket: one socket per mounted caller, reconnection owned
 * by the stream. Not a query — a push stream has nothing to cache.
 *
 * **The two rates are split, and that split is the point.** Pose and joints
 * are ~20 Hz each; as state they re-rendered the viewport subtree ~40 times a
 * second, so they are refs drained by the canvas's frame loop. `path` stays
 * state: it is ~0.333 Hz and a component outside the canvas branches on it,
 * and so does `dockPath` (2 Hz, only for the last metre of a dock).
 * A value a component branches on belongs in state; one only a render loop
 * reads does not — which is why the local costmap (2 Hz) and the local plan
 * (5 Hz) are refs on the feed, beside pose and joints.
 */
export function useTelemetry(): Telemetry {
  const pose = React.useRef<RobotPose | undefined>(undefined);
  const joints = React.useRef<Record<string, number> | undefined>(undefined);
  const localCostmap = React.useRef<LocalCostmap | undefined>(undefined);
  const localPlan = React.useRef<PlannedPath | undefined>(undefined);
  const [path, setPath] = React.useState<PlannedPath | undefined>(undefined);
  const [dockPath, setDockPath] = React.useState<PlannedPath | undefined>(undefined);

  const feed = React.useMemo<TelemetryFeed>(
    () => ({ pose, joints, localCostmap, localPlan }),
    [],
  );

  React.useEffect(() => {
    const stream = createTelemetryStream({
      onPose: (next) => {
        pose.current = next;
      },
      onJoints: (next) => {
        joints.current = next;
      },
      onPath: setPath,
      onDockPath: setDockPath,
      onLocalCostmap: (next) => {
        localCostmap.current = next;
      },
      onLocalPlan: (next) => {
        localPlan.current = next;
      },
    });
    return () => stream.close();
  }, []);

  return { feed, path, dockPath };
}
