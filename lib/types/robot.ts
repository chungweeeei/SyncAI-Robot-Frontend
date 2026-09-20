// Mirrors the backend Pydantic models in
// src/syncai_backend/syncai_backend/interfaces/rest/routers/robot.py.
// snake_case is preserved throughout, which is what lets `fetchRobotState` in
// lib/api/robot.ts parse a response straight into RobotState with no mapping
// layer — and what makes a field rename on the backend a type error here.
//
// The schemas at the bottom are the runtime half of that mirror: the interfaces
// say what this console expects, and `RobotStateSchema` is what checks the robot
// actually sent it. Each schema is annotated with the interface it must produce,
// so a field added above and forgotten below does not compile.

import { z } from "zod";

export type RobotMode = "MAINTENANCE" | "MANUAL" | "AUTO";

/**
 * What the gait controller reports it is doing — not `RobotState.mode`, which is
 * which byobu session is up.
 *
 * Open strings rather than unions on purpose: the backend decodes the controller's
 * integers through a lookup with an `"UNKNOWN"` fallback, and it will legitimately
 * hit that fallback — CHAMP/ISSAC are real policies the REST command surface does
 * not expose, and MPC's motion code is genuinely unknown.
 *
 * The payload carries labels only; the raw integers stay on the ROS topic. So
 * `"UNKNOWN"` is as much as the console can ever say, and two different unmapped
 * codes are indistinguishable here — `ros2 topic echo /<robot_id>/robot_state
 * --field low_level_mode` is where you find out which one it was.
 */
export interface RobotLowLevelMode {
  policy: string;
  motion: string;
}

export interface RobotPose {
  x: number;
  y: number;
  z: number;
  /** heading in degrees */
  theta: number;
}

/**
 * A pose on the map floor: what a drag on the viewport produces and what the
 * backend takes for both a nav goal and an initial-pose estimate. Theta is in
 * degrees, CCW from +x — the whole REST vocabulary is degrees.
 */
export interface PlanarPose {
  x: number;
  y: number;
  theta: number;
}

/**
 * Normalized teleop command, REP-103 body-frame axes: +vx forward, +vy left,
 * +wz counter-clockwise. Every component is in [-1, 1] on purpose — scaling to
 * m/s and rad/s is the sender's job, because the robot's velocity limits live
 * next to whatever will publish cmd_vel, not in a UI component that would
 * otherwise need re-editing every time a limit changes.
 *
 * Here rather than in useJoystick, where it was first written, because this is
 * the shape that goes on the wire: `encodeTeleopFrame` in lib/ros/teleop-frame.ts
 * is what turns it into a frame, and a `lib/` module reaching up into a UI input
 * hook for the definition of its own payload was the arrow pointing backwards.
 * The joystick is one producer of this shape, not its owner.
 */
export interface TeleopVector {
  vx: number;
  vy: number;
  wz: number;
}

/**
 * The planner's remaining global route, from the telemetry stream's `path`
 * frames. Flat map-frame metres — [x0, y0, x1, y1, …] — because the only
 * consumer walks it to build geometry, and a Float32Array of pairs is what that
 * loop wants rather than an array of objects.
 *
 * Heading is not carried: the viewport draws the route as a band on the floor,
 * not as a series of poses.
 *
 * An empty `points` is the explicit "no route" state, not a missing sample. The
 * backend synthesises it when plans stop arriving, because nothing in the nav
 * stack publishes an empty plan and arrival / cancel / abort are otherwise
 * indistinguishable silence.
 */
export interface PlannedPath {
  points: Float32Array;
  stamp: number;
}

export interface RobotLocalizationStatus {
  position: RobotPose;
  /** linear velocity in m/s */
  velocity: number;
}

export interface RobotNetworkStatus {
  ssid: string;
  bssid: string;
  /** signal strength in dBm */
  rssi: number;
  ip_address: string;
  mac_address: string;
}

export interface RobotBatteryStatus {
  battery_percentage: number;
}

/**
 * One joint's health. A subset of the ROS MotorState — q/dq/ddq/tau_est are not
 * exposed over REST, because robot_state is a 10 Hz snapshot whose samples
 * cannot be ordered. Live joint kinematics come from the telemetry WebSocket.
 */
export interface RobotMotorStatus {
  /** URDF joint name, matching the keys in lib/robot/g23-joints.ts */
  name: string;
  /** degrees Celsius */
  temperature: number;
  /** motor error code; 0 when healthy */
  error: number;
}

export interface RobotState {
  timestamp: number;
  robot_id: string;
  map: string;
  mode: RobotMode;
  low_level_mode: RobotLowLevelMode;
  /**
   * Whether localization_status carries a real pose. False before the
   * localizer converges, and for the whole of a mapping run (its TF chain
   * never reaches base_link) — the pose fields are then a zeroed placeholder.
   * A state frame with this false is still a live frame: mode, battery and
   * the gait state are all real.
   */
  localization_valid: boolean;
  localization_status: RobotLocalizationStatus;
  network_status: RobotNetworkStatus;
  battery_status: RobotBatteryStatus;
  /** empty while syncai_driver_manager is not publishing motor_states */
  motor_status: RobotMotorStatus[];
}

// Mirrors the ROS map_server YAML (map/warehouse.yaml)
export interface MapMetadata {
  /** meters per cell */
  resolution: number;
  /** world coordinates of the grid's bottom-left cell [x, y, yaw] */
  origin: [number, number, number];
  /** grid width in cells */
  width: number;
  /** grid height in cells */
  height: number;
}

// `OccupancyGrid` and `Vertex` used to live here and are gone: the first was an
// Int8Array alias nothing ever referenced (the editor's cells are a Uint8Array
// in lib/map/grid.ts, in .pgm byte values rather than the ROS -1/0/100), and the
// second was a map/vertexes.json shape that MapVertex in lib/types/map.ts
// replaced when vertices moved into Postgres with ids and a type.

// ---- Runtime schemas --------------------------------------------------
//
// Only for what actually arrives over REST. PlannedPath and TeleopVector are
// built by this console (from a WebSocket frame and from a thumbstick), so
// there is nothing to check; MapMetadata never arrives in this shape either —
// the catalogue sends `{x, y, yaw}` and lib/api/map.ts folds it into the tuple.
//
// Each is annotated with the interface it must produce, which is what makes the
// two halves impossible to drift apart: a field added above and forgotten here
// is a compile error rather than a silent `undefined` at runtime.

const RobotPoseSchema: z.ZodType<RobotPose> = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  theta: z.number(),
});

export const RobotStateSchema: z.ZodType<RobotState> = z.object({
  timestamp: z.number(),
  robot_id: z.string(),
  map: z.string(),
  mode: z.enum(["MAINTENANCE", "MANUAL", "AUTO"]),
  // Open strings, matching the interface: the backend's lookup has an
  // "UNKNOWN" fallback it legitimately hits, so an enum here would reject a
  // frame that is perfectly valid.
  low_level_mode: z.object({ policy: z.string(), motion: z.string() }),
  localization_valid: z.boolean(),
  localization_status: z.object({
    position: RobotPoseSchema,
    velocity: z.number(),
  }),
  network_status: z.object({
    ssid: z.string(),
    bssid: z.string(),
    rssi: z.number(),
    ip_address: z.string(),
    mac_address: z.string(),
  }),
  battery_status: z.object({ battery_percentage: z.number() }),
  motor_status: z.array(
    z.object({
      name: z.string(),
      temperature: z.number(),
      error: z.number(),
    }),
  ),
});
