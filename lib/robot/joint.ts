/**
 * How one joint is driven on a robot's GLB. scripts/urdf2glb.py keeps node
 * names equal to URDF link names and bakes the zero configuration, with no
 * rpy on any joint origin, so a joint is the child link looked up by name
 * and turned absolutely: setFromAxisAngle(axis, q).
 */
export interface JointSpec {
  /** URDF child-link name == GLB node name to rotate. */
  childLink: string;
  /**
   * Rotation axis in the child's parent frame (URDF <axis>). Numbers, not a
   * three.js vector: the robot's profile is read by the masthead, which must
   * not pull three.js in ahead of the emergency stop.
   */
  axis: readonly [number, number, number];
  /**
   * Position limits [lower, upper] in radians. None on a joint that turns
   * without end (a wheel).
   */
  limits?: [number, number];
}
