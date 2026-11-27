import type { RobotModelId } from "@/lib/robot/profile";

/** One channel offered as one tap, and why it is on the list. */
export interface TopicPreset {
  /** The channel's name as sent: relative ones are put under the robot's namespace. */
  topic: string;
  /** The plain-language half, the chip's tooltip only. */
  hint: string;
}

export interface RecordingTopics {
  /** The chips the recorder offers, in the order drawn. */
  presets: readonly TopicPreset[];
  /** The ones chosen when the page opens; each must be one of `presets`. */
  defaults: readonly string[];
}

/**
 * The channels each robot model's recorder offers — **edit here** to change
 * what either robot can record.
 *
 * Hardcoded rather than asked of the backend: there is no channel-list
 * route, and one would put a ROS graph query behind every visit. This can
 * drift from what the robot publishes, which is why each finished
 * recording's row shows its message count.
 *
 * Keyed by model because the two machines carry different sensors; the robot
 * says which it is (`robot_model`), so one image serves both.
 *
 * A relative name is expanded by the backend (`livox/lidar` →
 * `/robot01/livox/lidar`); an absolute one passes through as written, which
 * is what the transform pair needs, since it is not under the robot's
 * namespace.
 */
export const RECORDING_TOPICS: Readonly<Record<RobotModelId, RecordingTopics>> = {
  g23: {
    presets: [
      // The pair a lost mapping run is replayed from — the reason this page exists.
      { topic: "livox/lidar", hint: "Laser scanner — the robot's main sensor" },
      { topic: "livox/imu", hint: "Motion sensor — needed with the scanner to rebuild a map" },
      { topic: "imu", hint: "Body motion sensor — how the robot itself tilts and turns" },
      // The camera node is pinned to MJPG, so only image_raw/compressed
      // exists. It is opt-in at bringup, so without it this records nothing —
      // which the zero-message row will say.
      { topic: "image_raw/compressed", hint: "Camera picture" },
      // The camera has no usable calibration on this hardware, so this is
      // expected to record nothing until it does.
      { topic: "camera_info", hint: "Camera calibration — how the picture maps onto the world" },
      { topic: "/tf", hint: "How the robot's parts are placed as it moves" },
      { topic: "/tf_static", hint: "How the robot's fixed parts are mounted" },
      { topic: "odom", hint: "Where the robot calculates it has travelled" },
      // The localizer's own answers, so a replay can be checked against what
      // the robot believed at the time rather than only re-run from its inputs.
      { topic: "pointlio/lio_odom", hint: "Where the robot placed itself on the map" },
      { topic: "pointlio/body_cloud", hint: "The scan as the robot lined it up with its own body" },
      { topic: "initialpose", hint: "Starting positions an operator set on the map" },
      { topic: "robot_state", hint: "Overall status: battery, mode, motor health" },
    ],
    // The LIO inputs (also the backend's default). The camera is opt-in, by
    // request — its node is off at bringup on most robots.
    defaults: ["livox/lidar", "livox/imu"],
  },
  // The M20's own drivers publish its scanner and body IMU at absolute names,
  // outside the robot's namespace.
  m20: {
    presets: [
      { topic: "/LIDAR/POINTS_UDP", hint: "Laser scanner — the robot's main sensor" },
      { topic: "/IMU", hint: "Body motion sensor — how the robot itself tilts and turns" },
      { topic: "/tf", hint: "How the robot's parts are placed as it moves" },
      { topic: "/tf_static", hint: "How the robot's fixed parts are mounted" },
      { topic: "odom", hint: "Where the robot calculates it has travelled" },
      { topic: "pointlio/lio_odom", hint: "Where the robot placed itself on the map" },
      { topic: "pointlio/body_cloud", hint: "The scan as the robot lined it up with its own body" },
      { topic: "initialpose", hint: "Starting positions an operator set on the map" },
      { topic: "robot_state", hint: "Overall status: battery, mode, motor health" },
    ],
    defaults: ["/LIDAR/POINTS_UDP", "/IMU"],
  },
};

/**
 * The recorder's channels for the model the robot reports, or null while
 * that is not known (no frame yet, or a model this console does not know):
 * offering one model's channels to another records nothing, silently.
 */
export function recordingTopics(model: RobotModelId | null | undefined): RecordingTopics | null {
  return model ? RECORDING_TOPICS[model] : null;
}

/**
 * What a Start sends: the operator's choice, else the model's defaults, kept
 * to the channels this model offers — a choice made before the robot reported
 * another model must not carry the old one's channels over.
 */
export function topicsToSend(
  set: RecordingTopics,
  chosen: readonly string[] | null,
): string[] {
  const offered = new Set(set.presets.map((preset) => preset.topic));
  return (chosen ?? set.defaults).filter((topic) => offered.has(topic));
}
