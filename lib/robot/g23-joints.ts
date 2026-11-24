import type { JointSpec } from "@/lib/robot/joint";

// The 12 actuated G23 joints, transcribed from G23.urdf (lib/robot/joint.ts
// has how one is driven). Names match the driver's MotorState.name, which
// telemetry carries. The Ankle joints are fixed.

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
        axis,
        limits,
      },
    ]),
  ),
);
