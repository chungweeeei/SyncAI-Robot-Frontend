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

/*
 * How far the robot has to move from where it was last drawn before the
 * picture is drawn again: half a millimetre, half a milliradian. A standing
 * robot's pose still arrives twenty times a second with its last digits
 * moving, and the ease never quite lands, so without a floor a still robot
 * would redraw the whole map at the screen's refresh rate for changes no
 * pixel shows.
 */
export const POSE_REDRAW_M = 0.0005;
export const POSE_REDRAW_RAD = 0.0005;

/**
 * Whether a pose is far enough from the one last drawn to draw again.
 * Against the pose *drawn*, never the last frame's, so a slow creep adds up
 * and is drawn once it shows. Appearing or vanishing always is.
 */
export function poseMoved(drawn: SmoothPose | null, next: SmoothPose | null): boolean {
  if (!drawn || !next) return drawn !== next;
  return (
    Math.abs(next.x - drawn.x) > POSE_REDRAW_M ||
    Math.abs(next.y - drawn.y) > POSE_REDRAW_M ||
    Math.abs(next.z - drawn.z) > POSE_REDRAW_M ||
    Math.abs(next.yaw - drawn.yaw) > POSE_REDRAW_RAD
  );
}
