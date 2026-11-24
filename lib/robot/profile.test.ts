import { describe, expect, it } from "vitest";

import { motorLabel } from "@/lib/robot/motor-label";
import { G23_PROFILE, robotProfile, type RobotProfile } from "@/lib/robot/profile";

const profile = (model: string): RobotProfile => {
  const found = robotProfile(model);
  if (!found) throw new Error(`no profile for ${model}`);
  return found;
};

const KNOWN = ["g23", "m20"].map(profile);

describe("robotProfile", () => {
  it("answers by the model the robot reports, however it is cased", () => {
    expect(profile("m20").id).toBe("m20");
    expect(profile("G23").id).toBe("g23");
    expect(profile(" M20 ").id).toBe("m20");
  });

  it("takes a backend from before the field for a G23, the only robot it ran on", () => {
    expect(robotProfile(undefined)).toBe(G23_PROFILE);
  });

  it("draws nothing for a model it does not know, rather than guess one", () => {
    expect(robotProfile("x30")).toBeNull();
    expect(robotProfile("")).toBeNull();
    // Not a key of some object underneath.
    expect(robotProfile("constructor")).toBeNull();
  });
});

describe("every profile", () => {
  it("places each motor of its grid on a joint its model can turn", () => {
    for (const p of KNOWN) {
      const names = p.motorGrid.flatMap((leg) => leg.motors.map((m) => m.name));
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) expect(p.joints.has(name), `${p.id} ${name}`).toBe(true);
      // And leaves none of its joints off the grid, to land among the strays.
      expect(names).toHaveLength(p.joints.size);
    }
  });

  it("names a motor in its grid as the notice names the same motor", () => {
    // The overheating notice says "Hind left knee"; the grid has to say where
    // that is in the same words, or the operator cannot find it.
    for (const p of KNOWN) {
      for (const leg of p.motorGrid) {
        for (const motor of leg.motors) {
          expect(motorLabel(motor.name)).toBe(`${leg.label} ${motor.label.toLowerCase()}`);
        }
      }
    }
  });

  it("walks on joints its model has", () => {
    for (const p of KNOWN) {
      expect(p.walk.legs).toHaveLength(4);
      for (const leg of p.walk.legs) {
        for (const name of [leg.hipX, leg.hipY, leg.knee]) {
          expect(p.joints.has(name), `${p.id} ${name}`).toBe(true);
        }
      }
      if (p.walk.kind === "roll") {
        expect(p.walk.wheels).toHaveLength(4);
        for (const name of p.walk.wheels) {
          expect(p.joints.has(name), `${p.id} ${name}`).toBe(true);
        }
      }
    }
  });

  it("stands inside its joints' limits", () => {
    for (const p of KNOWN) {
      for (const leg of p.walk.legs) {
        const pairs: [string, number][] = [
          [leg.hipX, leg.stand.hipX],
          [leg.hipY, leg.stand.hipY],
          [leg.knee, leg.stand.knee],
        ];
        for (const [name, q] of pairs) {
          const [lower, upper] = p.joints.get(name)!.limits!;
          expect(q, `${p.id} ${name}`).toBeGreaterThanOrEqual(lower);
          expect(q, `${p.id} ${name}`).toBeLessThanOrEqual(upper);
        }
      }
    }
  });
});

describe("the M20", () => {
  const m20 = profile("m20");

  it("has sixteen joints under the URDF's own lower-case names", () => {
    expect(m20.joints.size).toBe(16);
    expect(m20.joints.get("fl_hipx_joint")?.childLink).toBe("fl_hipx");
    expect(m20.joints.get("hr_wheel_joint")?.childLink).toBe("hr_wheel");
  });

  it("lets a wheel turn without end", () => {
    for (const leg of ["fl", "fr", "hl", "hr"]) {
      expect(m20.joints.get(`${leg}_wheel_joint`)?.limits).toBeUndefined();
    }
  });

  it("admits the angles the robot reported lying down", () => {
    // Read off robot01 lying (2026-11-24): the front knees fold forward, the
    // hind ones back. The URDF's own limits, an export's with the sign
    // flipped, would refuse the hind pair.
    const lying: Record<string, number> = {
      fl_hipy_joint: -1.08,
      fl_knee_joint: 2.761,
      hl_hipy_joint: 1.173,
      hl_knee_joint: -2.761,
    };
    for (const [name, q] of Object.entries(lying)) {
      const [lower, upper] = m20.joints.get(name)!.limits!;
      expect(q, name).toBeGreaterThanOrEqual(lower);
      expect(q, name).toBeLessThanOrEqual(upper);
    }
  });

  it("gives each leg a wheel row under its knee", () => {
    for (const leg of m20.motorGrid) {
      expect(leg.motors.map((m) => m.label)).toEqual(["Hip roll", "Hip pitch", "Knee", "Wheel"]);
    }
  });

  it("stands taller than the G23", () => {
    expect(m20.baseHeightM).toBeGreaterThan(G23_PROFILE.baseHeightM);
  });
});
