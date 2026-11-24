import type { JointSpec } from "@/lib/robot/joint";

// The 16 actuated joints of the Lynx M20, a wheel at the end of each leg,
// transcribed from M20.urdf (lib/robot/joint.ts has how one is driven). The
// names are the URDF's, lower-case, which is what the robot's joint states
// carry.
//
// The axes are the URDF's. The limits are not: M20.urdf's hip pitch and knee
// <limit>s are the vendor's own model's with the sign flipped, an artefact of
// its export, so they are taken from that model (the range the angles the
// robot reports really move in). The front and hind legs fold opposite ways,
// which is why their ranges mirror; the left and right hips roll opposite
// ways, likewise.

type Limits = [number, number];

const LEGS: ReadonlyArray<{
  leg: string;
  hipX: Limits;
  hipY: Limits;
  knee: Limits;
}> = [
  { leg: "fl", hipX: [-0.436, 0.611], hipY: [-2.286, 2.583], knee: [-2.809, 2.792] },
  { leg: "fr", hipX: [-0.611, 0.436], hipY: [-2.286, 2.583], knee: [-2.809, 2.792] },
  { leg: "hl", hipX: [-0.436, 0.611], hipY: [-2.583, 2.286], knee: [-2.792, 2.809] },
  { leg: "hr", hipX: [-0.611, 0.436], hipY: [-2.583, 2.286], knee: [-2.792, 2.809] },
];

const ROLL: [number, number, number] = [-1, 0, 0];
const PITCH: [number, number, number] = [0, -1, 0];

const joint = (
  link: string,
  axis: [number, number, number],
  limits?: Limits,
): [string, JointSpec] => [
  `${link}_joint`,
  { childLink: link, axis, limits },
];

/** joint name (e.g. "fl_knee_joint") -> how to drive it on the GLB. */
export const M20_JOINTS: ReadonlyMap<string, JointSpec> = new Map(
  LEGS.flatMap(({ leg, hipX, hipY, knee }) => [
    joint(`${leg}_hipx`, ROLL, hipX),
    joint(`${leg}_hipy`, PITCH, hipY),
    joint(`${leg}_knee`, PITCH, knee),
    // A wheel turns without end: no limits.
    joint(`${leg}_wheel`, PITCH),
  ]),
);
