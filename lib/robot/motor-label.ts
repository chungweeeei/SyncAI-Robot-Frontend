// How the dashboard names a motor: the plan-view grid's leg and joint, in
// words an operator or a customer reads without a key, applied also to
// motors the grid does not place.

/** The legs in plan view: left column is the robot's left, top row its front. */
export const LEG_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ["FL", "FR"],
  ["HL", "HR"],
];

/** Each leg's name, by its code in the URDF. */
export const LEG_LABEL: Readonly<Record<string, string>> = {
  FL: "Front left",
  FR: "Front right",
  HL: "Hind left",
  HR: "Hind right",
};

/**
 * Proximal to distal. Words, not the codes (HX / HY / KN) they replaced: a
 * code needs a key, and the screen is shown to people who do not have one.
 * HipX turns the leg out from the body (roll), HipY swings it fore and aft
 * (pitch).
 */
export const JOINTS: ReadonlyArray<{ suffix: string; label: string }> = [
  { suffix: "HipX", label: "Hip roll" },
  { suffix: "HipY", label: "Hip pitch" },
  { suffix: "Knee", label: "Knee" },
];

export const jointName = (leg: string, suffix: string) => `${leg}_${suffix}_joint`;

const LEGS = new Set(LEG_ROWS.flat());
const JOINT_LABEL = new Map(JOINTS.map((joint) => [joint.suffix, joint.label]));
const LEG_JOINT = /^([A-Z]{2})_([A-Za-z0-9]+)_joint$/;

/**
 * Labels for motors the grid does not place (the driver's joint list may
 * still change), so a reading is listed rather than dropped. A leg-shaped
 * name reads as leg plus joint (or part name); anything else is
 * numbered, never shown raw. Only the numbered ones count toward the number.
 */
export function strayMotorLabels(names: readonly string[]): string[] {
  let others = 0;
  return names.map((name) => motorLabel(name, () => (others += 1)));
}

/**
 * One motor's label, by the same rule as the list (the overheating notice
 * uses it). Without `nextOther`, an unplaced motor is plain "Other motor".
 */
export function motorLabel(
  name: string,
  nextOther: () => number = () => 0,
): string {
  const match = LEG_JOINT.exec(name);
  if (match && LEGS.has(match[1])) {
    const [, leg, part] = match;
    return `${LEG_LABEL[leg]} ${(JOINT_LABEL.get(part) ?? part).toLowerCase()}`;
  }
  const ordinal = nextOther();
  return ordinal > 0 ? `Other motor ${ordinal}` : "Other motor";
}

