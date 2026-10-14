import * as THREE from "three";

// The 12 actuated G23 joints, transcribed from G23.urdf. The GLB baked by
// scripts/urdf2glb.py keeps node names equal to URDF link names and its pose
// is the zero configuration, so a joint is driven by looking the child link up
// by name and applying setFromAxisAngle(axis, q) absolutely (no joint origin
// has an rpy). Names match the driver's MotorState.name, which telemetry
// carries. The Ankle joints are fixed.

export interface JointSpec {
  /** URDF child-link name == GLB node name to rotate. */
  childLink: string;
  /** Rotation axis in the child's parent frame (URDF <axis>). */
  axis: THREE.Vector3;
  /** URDF position limits [lower, upper] in radians, for clamping. */
  limits: [number, number];
}

const LEGS = ["FL", "FR", "HL", "HR"] as const;

// All four legs share axes and limits; only the name prefix differs.
const LEG_JOINTS: ReadonlyArray<{
  suffix: string;
  link: string;
  axis: [number, number, number];
  limits: [number, number];
}> = [
  { suffix: "HipX_joint", link: "HIP", axis: [-1, 0, 0], limits: [-0.523, 0.523] },
  { suffix: "HipY_joint", link: "THIGH", axis: [0, -1, 0], limits: [-2.67, 0.314] },
  { suffix: "Knee_joint", link: "SHANK", axis: [0, -1, 0], limits: [0.524, 2.792] },
];

/** joint name (e.g. "FL_Knee_joint") -> how to drive it on the GLB. */
export const G23_JOINTS: ReadonlyMap<string, JointSpec> = new Map(
  LEGS.flatMap((leg) =>
    LEG_JOINTS.map(({ suffix, link, axis, limits }): [string, JointSpec] => [
      `${leg}_${suffix}`,
      {
        childLink: `${leg}_${link}`,
        axis: new THREE.Vector3(...axis),
        limits,
      },
    ]),
  ),
);
