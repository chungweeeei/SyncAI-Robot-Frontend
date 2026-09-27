import { describe, expect, it } from "vitest";

import { JOINTS, LEG_ROWS, jointName, strayMotorLabels } from "@/lib/robot/motor-label";

/**
 * The rule: a motor's label names a place on the robot, never the driver's
 * identifier for it.
 */
describe("strayMotorLabels", () => {
  it("names a leg's unknown joint by its leg and part", () => {
    expect(strayMotorLabels(["FL_Ankle_joint"])).toEqual(["FL Ankle"]);
  });

  it("uses the grid's code for a known joint on a leg", () => {
    // A known joint only reaches the strays if the grid failed to place it,
    // but it should still read the way the grid reads it.
    expect(strayMotorLabels(["HR_Knee_joint"])).toEqual(["HR KN"]);
  });

  it("numbers only the motors that have no leg to name them by", () => {
    expect(
      strayMotorLabels(["FL_Ankle_joint", "waist_motor", "XX_Knee_joint"]),
    ).toEqual(["FL Ankle", "Other motor 1", "Other motor 2"]);
  });

  it("never prints the raw joint name", () => {
    const labels = strayMotorLabels(["FL_Ankle_joint", "waist_motor", "HR_Knee_joint"]);
    for (const label of labels) {
      expect(label).not.toContain("_");
      expect(label).not.toMatch(/joint|motor_/i);
    }
  });
});

describe("the plan-view grid", () => {
  it("places the twelve G23 actuators under their URDF names", () => {
    const names = LEG_ROWS.flat().flatMap((leg) =>
      JOINTS.map((joint) => jointName(leg, joint.suffix)),
    );
    expect(names).toHaveLength(12);
    expect(names).toContain("FL_HipX_joint");
    expect(names).toContain("HR_Knee_joint");
  });
});
