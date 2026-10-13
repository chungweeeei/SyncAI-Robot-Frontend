// Mirrors the backend's robot models, snake_case, so a response parses
// straight into RobotState. The schemas at the bottom are the runtime check.

import { z } from "zod";

export type RobotMode = "MAINTENANCE" | "MANUAL" | "AUTO";

/**
 * What the gait controller reports (not `RobotState.mode`).
 *
 * Open strings on purpose: the backend's lookup falls back to `"UNKNOWN"` and
 * legitimately hits it (unexposed policies, MPC's motion code). Only labels
 * arrive, so two unmapped codes look the same here; the robot's own
 * `robot_state` topic has the integers.
 */
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
 * Normalized teleop command, REP-103 body frame: +vx forward, +vy left, +wz
 * CCW, each in [-1, 1]. Velocity limits live with the robot, not the UI.
 */
export interface TeleopVector {
  vx: number;
  vy: number;
  wz: number;
}

/**
 * The planner's remaining route, flat map-frame metres [x0, y0, x1, y1, …],
 * the layout the geometry builder walks.
 *
 * An empty `points` is an explicit "no route", synthesised by the backend
 * when plans stop: otherwise arrival, cancel and abort are all silence.
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

/** One joint's health. Kinematics are not here; they come from telemetry. */
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

// ---- Runtime schemas --------------------------------------------------
//
// Only for what arrives over REST (MapMetadata arrives as `{x, y, yaw}` and is
// folded in lib/api/map.ts).

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
