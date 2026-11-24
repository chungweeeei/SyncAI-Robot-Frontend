import { describe, expect, it } from "vitest";

import { robotProfile } from "@/lib/robot/profile";
import { walkAngles, type RollWalk, type StepWalk } from "@/lib/robot/walk";

const m20Walk = robotProfile("m20")!.walk;
const g23Walk = robotProfile("g23")!.walk;
if (m20Walk.kind !== "roll" || g23Walk.kind !== "step") throw new Error("gaits moved");
const m20: RollWalk = m20Walk;
const g23: StepWalk = g23Walk;

const at = (t: number, distanceM = 0) => ({ t, distanceM });

describe("walkAngles", () => {
  it("is the standing pose when there is no motion", () => {
    for (const walk of [g23, m20]) {
      const angles = walkAngles(walk, null);
      for (const leg of walk.legs) {
        expect(angles[leg.hipX]).toBe(leg.stand.hipX);
        expect(angles[leg.hipY]).toBe(leg.stand.hipY);
        expect(angles[leg.knee]).toBe(leg.stand.knee);
      }
    }
  });

  it("walks the G23 and rolls the M20", () => {
    // The M20 drives on its wheels with its legs held; a stepping M20 was a
    // wheeled robot shown walking, which it does not do.
    expect(g23.kind).toBe("step");
    expect(m20.kind).toBe("roll");
  });

  it("lifts a knee by folding it further the way it already bends", () => {
    for (let t = 0; t < g23.stepS; t += g23.stepS / 16) {
      const angles = walkAngles(g23, at(t));
      for (const leg of g23.legs) {
        expect(Math.abs(angles[leg.knee])).toBeGreaterThanOrEqual(
          Math.abs(leg.stand.knee) - 1e-9,
        );
      }
    }
  });

  it("moves the diagonal pairs together and the two pairs half a step apart", () => {
    const now = walkAngles(g23, at(0.2));
    const half = walkAngles(g23, at(0.2 + g23.stepS / 2));
    const swing = (angles: Record<string, number>, index: number) =>
      angles[g23.legs[index].hipY] - g23.legs[index].stand.hipY;
    // FL, FR, HL, HR
    expect(swing(now, 0)).toBeCloseTo(swing(now, 3));
    expect(swing(now, 1)).toBeCloseTo(swing(now, 2));
    expect(swing(now, 0)).toBeCloseTo(swing(half, 1));
  });

  it("comes back to where it started after one step", () => {
    const start = walkAngles(g23, at(0.3));
    const next = walkAngles(g23, at(0.3 + g23.stepS));
    for (const [name, q] of Object.entries(start)) expect(next[name]).toBeCloseTo(q);
  });

  it("holds a rolling robot's legs in its standing pose while it moves", () => {
    const angles = walkAngles(m20, at(7.3, 2.4));
    for (const leg of m20.legs) {
      expect(angles[leg.hipX]).toBe(leg.stand.hipX);
      expect(angles[leg.hipY]).toBe(leg.stand.hipY);
      expect(angles[leg.knee]).toBe(leg.stand.knee);
    }
  });

  it("turns the wheels by the ground covered, so they do not slip", () => {
    // One full turn of a wheel is its circumference of ground.
    const turn = 2 * Math.PI * m20.wheelRadiusM;
    const angles = walkAngles(m20, at(3, turn));
    for (const wheel of m20.wheels) expect(Math.abs(angles[wheel])).toBeCloseTo(2 * Math.PI);
    // By the distance alone: the same ground at another time, the same turn.
    expect(walkAngles(m20, at(9, turn))).toEqual(angles);
  });
});
