// How the drawn pose follows the reported one.

// Time constant (seconds) of the easing applied to the reported pose. The
// dashboard's feed is now the ~20 Hz telemetry WebSocket, so the filter's job
// shrank from hiding a 1 Hz snapshot cadence (tau 0.25 then) to bridging the
// 50 ms gaps between frames — 0.1 s does that while cutting the lag the old
// value would now just waste. It is deliberately a filter rather than a
// replay buffer: smoothing costs a fraction of a second of lag but never
// renders a pose the robot has already left behind, which a buffer would.
export const POSE_EASE_TAU_S = 0.1;

/** Pose the robot is actually drawn at, eased toward the reported one. */
export interface SmoothPose {
  x: number;
  y: number;
  z: number;
  /**
   * Radians, and deliberately *not* wrapped to [-π, π]: each new target is
   * unwrapped against this value so easing always takes the short way round.
   */
  yaw: number;
}
