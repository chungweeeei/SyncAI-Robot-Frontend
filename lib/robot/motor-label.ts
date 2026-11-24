// How the console names a motor the motor grid does not place: by its leg
// and joint, in words an operator or a customer reads without a key. The
// grid's own rows are the robot's profile (lib/robot/profile.ts); this is the
// rule for every other name, and for the overheating notice, which names one
// motor on its own.

/** Each leg's name, by its code in the URDF (upper-case here; the M20's are lower). */
const LEG_LABEL: ReadonlyMap<string, string> = new Map([
  ["FL", "Front left"],
  ["FR", "Front right"],
  ["HL", "Hind left"],
  ["HR", "Hind right"],
]);

/** A joint's words, by the URDF's name for it in lower case. */
const JOINT_LABEL: ReadonlyMap<string, string> = new Map([
  ["hipx", "hip roll"],
  ["hipy", "hip pitch"],
  ["knee", "knee"],
  ["wheel", "wheel"],
]);

// Either robot's spelling: FL_HipX_joint, fl_hipx_joint.
const LEG_JOINT = /^([A-Za-z]{2})_([A-Za-z0-9]+)_joint$/;

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
  const leg = match ? LEG_LABEL.get(match[1].toUpperCase()) : undefined;
  if (match && leg) {
    const part = match[2].toLowerCase();
    return `${leg} ${JOINT_LABEL.get(part) ?? part}`;
  }
  const ordinal = nextOther();
  return ordinal > 0 ? `Other motor ${ordinal}` : "Other motor";
}
