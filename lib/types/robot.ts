// Mirrors the backend's robot models, snake_case, so a response parses
// straight into RobotState. The schemas at the bottom are the runtime check.

import * as z from "zod";

export type RobotMode = "MAINTENANCE" | "MANUAL" | "AUTO";

/**
 * What the gait controller reports (not `RobotState.mode`).
 *
 * Open strings on purpose: the backend's lookup falls back to `"UNKNOWN"` and
 * legitimately hits it (unexposed policies, MPC's motion code). Only labels
 * arrive, so two unmapped codes look the same here; the robot's own
 * `robot_state` topic has the integers.
 */
/**
 * The robot's state machine as one word, most-severe-first: ERROR (a job
 * failed; latched until an operator releases it) > UNINITIALIZED (no operator
 * has confirmed the robot's position) > RUNNING > CHARGING > WARNING (battery
 * low) > IDLE. One value at a time, so a word that is neither ERROR nor
 * UNINITIALIZED also says the position is confirmed, and a robot on its
 * charger before that reads UNINITIALIZED. An open string, like the
 * low-level mode: the backend answers UNKNOWN for a code it cannot name.
 * What the console makes of each word is lib/robot/readiness.ts.
 *
 * A backend from before the state machine sends UNINITIALIZED (then: not
 * localized), CHARGING, WARNING and IDLE only; `localization_converged` is
 * how the two are told apart.
 */
export type RobotStatus = string;

export interface RobotLowLevelMode {
  policy: string;
  motion: string;
  /**
   * The driver's safety lock — the emergency stop. False before the driver
   * has ever published, indistinguishable from a real release.
   */
  safety_locked: boolean;
}

export interface RobotPose {
  x: number;
  y: number;
  z: number;
  /** degrees */
  theta: number;
}

/** A pose on the map floor (a goal, an initial pose). Theta in degrees, CCW from +x. */
export interface PlanarPose {
  x: number;
  y: number;
  theta: number;
}

/**
 * A planar pose on one floor of a map that spans several: `z` is the ground
 * height of that floor, metres, 0 on the ground floor (see `floorGround`).
 */
export interface PlacedPose extends PlanarPose {
  z: number;
}

/**
 * Normalized teleop command, REP-103 body frame: +vx forward, +vy left, +wz
 * CCW, each in [-1, 1]. Velocity limits live with the robot, not the UI.
 */
export interface TeleopVector {
  vx: number;
  vy: number;
  wz: number;
}

/**
 * The planner's remaining route, flat map-frame metres [x0, y0, z0, x1, …],
 * the layout the geometry builder walks. z is the ground under each point, as
 * a waypoint's is, so a route up a stair is on both storeys it joins.
 *
 * An empty `points` is an explicit "no route", synthesised by the backend
 * when plans stop: otherwise arrival, cancel and abort are all silence.
 */
export interface PlannedPath {
  points: Float32Array;
  stamp: number;
}

/**
 * The robot's own picture of what is around it while it drives: the 4 × 4 m
 * costmap its controller steers on, sent only during a navigation.
 *
 * `cells` is one byte per cell, row-major from the `origin` corner with x
 * along a row, in the robot's own cost values: 0 free, 1–252 the margin kept
 * from an obstacle, 253 too close for the body, 254 an obstacle, 255 never
 * seen. The grid is turned by `origin.yaw` (radians) in the map frame. It is
 * planar: it is drawn on the ground the robot stands on.
 *
 * A `width` of 0 is the explicit "no costmap", sent when the navigation ends.
 */
export interface LocalCostmap {
  resolution: number;
  width: number;
  height: number;
  origin: { x: number; y: number; yaw: number };
  cells: Uint8Array;
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

/** One joint's health. Kinematics are not here; they come from telemetry. */
export interface RobotMotorStatus {
  /** URDF joint name, matching the keys of the robot's joint table (lib/robot/profile.ts) */
  name: string;
  /** degrees Celsius */
  temperature: number;
  /** motor error code; 0 when healthy */
  error: number;
}

export interface RobotState {
  timestamp: number;
  robot_id: string;
  /**
   * Which kind of robot this is, lower-case (`g23`, `m20`): what the console
   * picks the 3D model and the motor grid by (lib/robot/profile.ts). Absent
   * only from a backend older than the field, which ran on G23s alone.
   */
  robot_model?: string;
  map: string;
  mode: RobotMode;
  /**
   * Absent from a backend older than the field, which must still answer a
   * whole frame: the two repos are deployed independently.
   */
  state?: RobotStatus;
  /**
   * Whether the robot's last position guess has settled on the map, which is
   * what lets an operator confirm it — never that the position is right; that
   * judgement is the operator's. Absent from a backend older than the state
   * machine, and its presence is how the console knows the robot gates jobs
   * on `state` at all (`gateSupported` in lib/robot/readiness.ts).
   */
  localization_converged?: boolean;
  /**
   * One sentence for the operator on why `state` is what it is: what the
   * robot waits for while UNINITIALIZED, which job failed while ERROR. Shown
   * verbatim; "" when there is nothing to add. Absent from an older backend.
   */
  state_message?: string;
  low_level_mode: RobotLowLevelMode;
  /**
   * Whether localization_status is real. False before convergence and for the
   * whole of a mapping run, when the pose is a zeroed placeholder; the rest
   * of the frame is still live.
   */
  localization_valid: boolean;
  localization_status: RobotLocalizationStatus;
  network_status: RobotNetworkStatus;
  battery_status: RobotBatteryStatus;
  /** empty while the driver is not publishing */
  motor_status: RobotMotorStatus[];
}

// ---- Runtime schemas --------------------------------------------------
//
// Only for what arrives over REST.

const RobotPoseSchema: z.ZodType<RobotPose> = z.object({
  x: z.number(),
  y: z.number(),
  z: z.number(),
  theta: z.number(),
});

export const RobotStateSchema: z.ZodType<RobotState> = z.object({
  timestamp: z.number(),
  robot_id: z.string(),
  robot_model: z.string().optional(),
  map: z.string(),
  mode: z.enum(["MAINTENANCE", "MANUAL", "AUTO"]),
  state: z.string().optional(),
  // Optional, not defaulted: their absence is the reading "this backend has
  // no state machine", and a default would turn every old frame into a robot
  // that has not converged.
  localization_converged: z.boolean().optional(),
  state_message: z.string().optional(),
  // Open strings, matching the interface.
  low_level_mode: z.object({
    policy: z.string(),
    motion: z.string(),
    safety_locked: z.boolean(),
  }),
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
