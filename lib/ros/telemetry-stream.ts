import {
  createReconnectingSocket,
  type ReconnectingSocket,
} from "@/lib/ros/socket";
import type { PlannedPath, RobotPose } from "@/lib/types/robot";
import type { StreamStatus } from "@/lib/types/stream";

/**
 * The high-rate telemetry socket the 3D viewer reads pose and joints from.
 * Separate from GET /robot/state (a frozen third-party contract, polled, with
 * whole-second stamps) and from the scan stream (see lib/ros/socket.ts).
 *
 * JSON text frames multiplexed by ``type``:
 *
 *   {"type": "pose",   "x", "y", "z", "yaw_deg", "stamp"}
 *   {"type": "joints", "joints": {"FL_HipX_joint": rad, ...}, "stamp"}
 *   {"type": "path",   "points": [[x, y, z], ...], "stamp"}
 *   {"type": "dock_path", "points": [[x, y], ...], "stamp"}
 *
 * `path` can share it: ~8 kB per replan (~0.333 Hz) is too small to block.
 * `dock_path` is the last metre of a dock (2 Hz, a few dozen points): the
 * approach the robot predicts from where it stands to the dock, which no
 * planner draws. The staging leg before it is an ordinary `path`.
 */

interface PoseMessage {
  type: "pose";
  x: number;
  y: number;
  z: number;
  yaw_deg: number;
  stamp: number;
}

interface JointsMessage {
  type: "joints";
  joints: Record<string, number>;
  stamp: number;
}

interface PathMessage {
  type: "path";
  /**
   * Map-frame [x, y, z] triples, metres, z the ground under each. A backend
   * from before z sends [x, y], a route on the ground floor. Empty means
   * "no route".
   */
  points: [number, number, number?][];
  stamp: number;
}

interface DockPathMessage {
  type: "dock_path";
  /**
   * Map-frame [x, y] pairs, metres, flattened with the route's z of 0: a dock
   * is on the floor plan, which is the ground floor. Empty means "the
   * approach is over".
   */
  points: [number, number, number?][];
  stamp: number;
}

type TelemetryMessage = PoseMessage | JointsMessage | PathMessage | DockPathMessage;

export interface TelemetryStreamHandlers {
  onPose?: (pose: RobotPose) => void;
  /** Joint angles in radians, keyed by URDF joint name. */
  onJoints?: (joints: Record<string, number>) => void;
  /** The planner's route. An empty `points` means the route is over. */
  onPath?: (path: PlannedPath) => void;
  /** A dock's final approach. An empty `points` means the dock goal ended. */
  onDockPath?: (path: PlannedPath) => void;
  onStatus?: (status: StreamStatus) => void;
}

export function createTelemetryStream(
  handlers: TelemetryStreamHandlers,
  path = "/api/v1/robot/telemetry/stream",
): ReconnectingSocket {
  return createReconnectingSocket(path, {
    onStatus: handlers.onStatus,
    onMessage: (data) => decodeTelemetryFrame(data, handlers),
  });
}

/** One frame onto its handler. Exported for the tests; the socket is its only caller. */
export function decodeTelemetryFrame(
  data: unknown,
  handlers: TelemetryStreamHandlers,
): void {
  if (typeof data !== "string") return;
  let msg: TelemetryMessage;
  try {
    msg = JSON.parse(data) as TelemetryMessage;
  } catch {
    return; // malformed frame; skip rather than kill the stream
  }
  if (msg.type === "pose") {
    handlers.onPose?.({ x: msg.x, y: msg.y, z: msg.z, theta: msg.yaw_deg });
  } else if (msg.type === "joints") {
    handlers.onJoints?.(msg.joints);
  } else if (msg.type === "path") {
    handlers.onPath?.(plannedPath(msg));
  } else if (msg.type === "dock_path") {
    handlers.onDockPath?.(plannedPath(msg));
  }
}

/**
 * Flattened here, the wire-to-app layer, into the layout the geometry builder
 * walks.
 */
function plannedPath(msg: PathMessage | DockPathMessage): PlannedPath {
  const points = new Float32Array(msg.points.length * 3);
  for (let i = 0; i < msg.points.length; i++) {
    points[i * 3] = msg.points[i][0];
    points[i * 3 + 1] = msg.points[i][1];
    points[i * 3 + 2] = msg.points[i][2] ?? 0;
  }
  return { points, stamp: msg.stamp };
}
