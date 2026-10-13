"use client";

import * as React from "react";

import { createTelemetryStream } from "@/lib/ros/telemetry-stream";
import type { PlannedPath, RobotPose } from "@/lib/types/robot";

/**
 * Pose and joints as refs, read once per drawn frame. Each message is a fresh
 * object, so a 60 Hz draw loop tells a new frame by identity. The object is
 * stable for the hook's lifetime.
 */
export interface TelemetryFeed {
  /** Map-frame pose. */
  readonly pose: React.RefObject<RobotPose | undefined>;
  /** Joint angles in radians, by URDF name. */
  readonly joints: React.RefObject<Record<string, number> | undefined>;
}

export interface Telemetry {
  feed: TelemetryFeed;
  /**
   * The planner's route. An empty `points` arrives when the run ends — the
   * clear is sent, not inferred from silence (see the backend's get_path).
   */
  path: PlannedPath | undefined;
}

/**
 * The telemetry WebSocket: one socket per mounted caller, reconnection owned
 * by the stream. Not a query — a push stream has nothing to cache.
 *
 * **The two rates are split, and that split is the point.** Pose and joints
 * are ~20 Hz each; as state they re-rendered the viewport subtree ~40 times a
 * second, so they are refs drained by the canvas's frame loop. `path` stays
 * state: it is ~0.333 Hz and a component outside the canvas branches on it.
 * A value a component branches on belongs in state; one only a render loop
 * reads does not.
 */
export function useTelemetry(): Telemetry {
  const pose = React.useRef<RobotPose | undefined>(undefined);
  const joints = React.useRef<Record<string, number> | undefined>(undefined);
  const [path, setPath] = React.useState<PlannedPath | undefined>(undefined);

  const feed = React.useMemo<TelemetryFeed>(() => ({ pose, joints }), []);

  React.useEffect(() => {
    const stream = createTelemetryStream({
      onPose: (next) => {
        pose.current = next;
      },
      onJoints: (next) => {
        joints.current = next;
      },
      onPath: setPath,
    });
    return () => stream.close();
  }, []);

  return { feed, path };
}
