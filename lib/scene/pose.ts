// How the drawn pose follows the reported one.

// Easing time constant (s) toward the reported pose: bridges the ~50 ms gaps
// of the 20 Hz feed. A filter, not a replay buffer, so it never renders a pose
// the robot has already left.
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
