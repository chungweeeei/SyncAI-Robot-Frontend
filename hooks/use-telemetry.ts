"use client";

import * as React from "react";

import { createTelemetryStream } from "@/lib/ros/telemetry-stream";
import type { PlannedPath, RobotPose } from "@/lib/types/robot";

/**
 * Pose and joints as refs: a live feed a renderer reads once per drawn frame,
 * rather than props that arrive as a render.
 *
 * Both are replaced on a fresh object every message, so a consumer tells "the
 * same frame again" from "a new one" by identity — which is what lets a 60 Hz
 * draw loop poll a 20 Hz feed for free.
 *
 * The refs are stable for the hook's lifetime and so is this object, so it can
 * sit in a dependency array without re-running anything.
 */
export interface TelemetryFeed {
  /** Map-frame pose. Undefined until the first frame. */
  readonly pose: React.RefObject<RobotPose | undefined>;
  /** Joint angles in radians, by URDF name. Undefined until the first frame. */
  readonly joints: React.RefObject<Record<string, number> | undefined>;
}

export interface Telemetry {
  feed: TelemetryFeed;
  /**
   * The planner's route, on the same stream as the pose. Undefined until the
   * first plan; an empty `points` arrives when the run ends, which is what takes
   * the band back off the floor — see the backend's TelemetryRepo.get_path on why
   * that clear has to be sent rather than inferred from silence.
   */
  path: PlannedPath | undefined;
}

/**
 * The telemetry WebSocket: one socket per mounted caller, opened on mount and
 * closed on unmount, reconnection owned by the stream. Pose and joints replaced
 * polling GET /api/v1/robot/state for the 3D viewer: that endpoint's timestamp
 * has whole-second resolution and it is a polled, frozen third-party contract,
 * so no amount of client-side polling or easing could make the motion
 * continuous.
 *
 * Not a query, even though every other server read here goes through TanStack
 * Query: there is no request/response to cache, and the library's vocabulary
 * (stale, refetch, invalidate) has no meaning for a push stream.
 *
 * **The two rates are split, and that split is the point.** Pose and joints
 * arrive as separate messages at ~20 Hz each, so routing them through state
 * meant up to ~40 renders a second of the whole viewport subtree — a tree with
 * almost no memoisation, holding a three.js canvas that does not want to be
 * re-rendered at all. They are refs now, drained by the canvas's own frame loop
 * (see PointCloudCanvas's `telemetry` prop), which is the same treatment the
 * point cloud has always had for the same reason.
 *
 * `path` stays React state, and that is not an oversight: it is ~8 kB once per
 * replan (~0.333 Hz), and it has a consumer outside the canvas — the viewport's
 * route readout renders on whether a route exists at all. A value a component
 * branches on belongs in state; a value only a render loop reads does not.
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
