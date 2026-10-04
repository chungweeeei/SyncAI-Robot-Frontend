// How a motor is named on the dashboard's motor status. The grid lays the
// twelve G23 actuators out as a plan view, leg by leg, and labels each by a
// short joint code. This module is the naming half, so a motor the grid does
// not place is still named the same way, in the operator's terms.

/** The legs in plan view: left column is the robot's left, top row its front. */
export const LEG_ROWS: ReadonlyArray<ReadonlyArray<string>> = [
  ["FL", "FR"],
  ["HL", "HR"],
];

/**
 * Proximal to distal, the order the leg is actually built in. Abbreviated
 * because the full URDF names (FL_HipX_joint) are four times the width of the
 * number they label and identical down every leg.
 */
export const JOINTS: ReadonlyArray<{ suffix: string; label: string }> = [
  { suffix: "HipX", label: "HX" },
  { suffix: "HipY", label: "HY" },
  { suffix: "Knee", label: "KN" },
];

/** The URDF name the driver reports for one leg's joint. */
export const jointName = (leg: string, suffix: string) => `${leg}_${suffix}_joint`;

const LEGS = new Set(LEG_ROWS.flat());
const JOINT_LABEL = new Map(JOINTS.map((joint) => [joint.suffix, joint.label]));
const LEG_JOINT = /^([A-Z]{2})_([A-Za-z0-9]+)_joint$/;

/**
 * Labels for the motors the plan-view grid does not place, in the order given.
 *
 * The driver's joint list has an open TODO about its ordering, so a renamed
 * or added joint is a live possibility, and the dashboard lists it rather
 * than drop a reading. It used to list it by its raw URDF name, which is an
 * internal identifier and does not belong on an operator's screen. A name
 * that still reads as leg plus joint is shown the way the grid shows one: the
 * leg, then the joint's code if it is a known joint, or its own part name if
 * not. Anything else is numbered, because a raw name is the one thing this
 * console has decided not to print, even in small text. The numbers count
 * only the motors that get one, so a lone unnamed motor is "Other motor 1"
 * however many named strays sit above it.
 */
export function strayMotorLabels(names: readonly string[]): string[] {
  let others = 0;
  return names.map((name) => motorLabel(name, () => (others += 1)));
}

/**
 * One motor's label on its own, for a surface that names a single motor
 * rather than listing them (the overheating notice). The same rule as the
 * list, so the notice and the grid agree about what to call a joint; a
 * motor that is neither placed nor leg-shaped is "Other motor" with no
 * number, since there is no list for a number to count in.
 */
export function motorLabel(
  name: string,
  /** Hands back the ordinal for a motor that needs one. Unnumbered without it. */
  nextOther: () => number = () => 0,
): string {
  const match = LEG_JOINT.exec(name);
  if (match && LEGS.has(match[1])) {
    const [, leg, part] = match;
    return `${leg} ${JOINT_LABEL.get(part) ?? part}`;
  }
  const ordinal = nextOther();
  return ordinal > 0 ? `Other motor ${ordinal}` : "Other motor";
}

