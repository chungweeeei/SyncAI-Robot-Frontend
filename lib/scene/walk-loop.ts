// The sign-in screen's route: an oval the robot walks round on its ground,
// as it would follow a route the planner gave it.

/** The oval's half-lengths, metres. */
export const LOOP_RADIUS_X_M = 2.6;
export const LOOP_RADIUS_Y_M = 1.6;
/** One lap, seconds: about walking pace for a robot this size. */
export const LOOP_PERIOD_S = 40;

export interface LoopPose {
  x: number;
  y: number;
  /** Heading, radians, along the oval. */
  yaw: number;
}

/** Where the robot is `t` seconds in, counter-clockwise from the oval's right end. */
export function loopPose(t: number): LoopPose {
  const s = (2 * Math.PI * t) / LOOP_PERIOD_S;
  return {
    x: LOOP_RADIUS_X_M * Math.cos(s),
    y: LOOP_RADIUS_Y_M * Math.sin(s),
    // The tangent of the oval at s: d/ds of (a cos s, b sin s).
    yaw: Math.atan2(LOOP_RADIUS_Y_M * Math.cos(s), -LOOP_RADIUS_X_M * Math.sin(s)),
  };
}

/** The oval's speed at angle s, metres per radian of s. */
function loopSpeed(s: number): number {
  return Math.hypot(LOOP_RADIUS_X_M * Math.sin(s), LOOP_RADIUS_Y_M * Math.cos(s));
}

/** The ground covered from angle 0 to s in [0, 2π], by Simpson's rule. */
function arcTo(s: number, steps = 64): number {
  const h = s / steps;
  let sum = loopSpeed(0) + loopSpeed(s);
  for (let i = 1; i < steps; i += 1) sum += (i % 2 ? 4 : 2) * loopSpeed(i * h);
  return (sum * h) / 3;
}

/** One lap's length, metres: an ellipse's perimeter has no closed form. */
const LAP_M = arcTo(2 * Math.PI, 256);

/**
 * The ground covered `t` seconds in, metres: what a wheel rolling round the
 * oval has turned through. Whole laps by their length and the rest by a
 * fixed number of steps, so the cost is the same an hour in.
 */
export function loopDistance(t: number): number {
  const laps = t / LOOP_PERIOD_S;
  const whole = Math.floor(laps);
  return whole * LAP_M + arcTo(2 * Math.PI * (laps - whole));
}

/**
 * The stretch of the oval ahead of the robot `t` seconds in, as [x, y, z]
 * triples at ground height 0, starting where it stands: the route it is
 * following, drawn only as far as the next bend, not as a whole ring.
 */
export function routeAhead(t: number, span = 1.2, segments = 40): Float32Array {
  const s0 = (2 * Math.PI * t) / LOOP_PERIOD_S;
  const points = new Float32Array((segments + 1) * 3);
  for (let i = 0; i <= segments; i += 1) {
    const s = s0 + (span * i) / segments;
    points[i * 3] = LOOP_RADIUS_X_M * Math.cos(s);
    points[i * 3 + 1] = LOOP_RADIUS_Y_M * Math.sin(s);
    points[i * 3 + 2] = 0;
  }
  return points;
}

/** How far out from the oval the camera stands, and how high, metres. */
const CHASE_OUT_M = 2.8;
const CHASE_UP_M = 2.6;
/** How much the camera trails behind the robot, against the outward pull. */
const CHASE_BEHIND = 0.6;

/**
 * Where the camera stands `t` seconds in, and what it looks at: outside the
 * oval and a little behind the robot, looking in at it. Outside, because the
 * shelving run stands inside the oval; a camera fixed to one side of the set
 * had the shelf between it and the robot for half of every lap.
 */
export function chaseCamera(t: number): {
  position: [number, number, number];
  target: [number, number, number];
} {
  const s = (2 * Math.PI * t) / LOOP_PERIOD_S;
  const { x, y, yaw } = loopPose(t);
  // The oval's outward normal at s: the gradient of x²/a² + y²/b².
  let nx = Math.cos(s) / LOOP_RADIUS_X_M;
  let ny = Math.sin(s) / LOOP_RADIUS_Y_M;
  const n = Math.hypot(nx, ny);
  nx /= n;
  ny /= n;
  let dx = nx - Math.cos(yaw) * CHASE_BEHIND;
  let dy = ny - Math.sin(yaw) * CHASE_BEHIND;
  const d = Math.hypot(dx, dy);
  dx /= d;
  dy /= d;
  return {
    position: [x + dx * CHASE_OUT_M, y + dy * CHASE_OUT_M, CHASE_UP_M],
    target: [x, y, 0.25],
  };
}
