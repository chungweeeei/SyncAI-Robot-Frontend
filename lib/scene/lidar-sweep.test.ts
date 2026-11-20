import { describe, expect, it } from "vitest";

import { DEMO_PROPS } from "@/lib/scene/demo-site";
import {
  SWEEP_FAN,
  SWEEP_RANGE_M,
  SWEEP_TURN_S,
  castRay,
  sweepFan,
  type SweepProp,
} from "@/lib/scene/lidar-sweep";

const SHELF: SweepProp = { x: 3, y: 0, w: 1, d: 1, h: 1.6 };

describe("castRay", () => {
  it("lands on the near face of a prop, never on the ground behind it", () => {
    const hit = castRay([0, 0, 0.5], [1, 0, 0], [SHELF]);
    expect(hit).not.toBeNull();
    expect(hit![0]).toBeCloseTo(2.5);
    expect(hit![2]).toBeCloseTo(0.5);
  });

  it("lands on the ground where a downward ray meets it", () => {
    const d = Math.SQRT1_2;
    const hit = castRay([0, 0, 1], [d, 0, -d], []);
    expect(hit![0]).toBeCloseTo(1);
    expect(hit![2]).toBeCloseTo(0);
  });

  it("finds nothing for a ray over every prop into open air", () => {
    expect(castRay([0, 0, 0.5], [0, 0, 1], [SHELF])).toBeNull();
    expect(castRay([0, 0, 2], [1, 0, 0], [SHELF])).toBeNull();
  });

  it("never reaches past its range", () => {
    const far: SweepProp = { ...SHELF, x: SWEEP_RANGE_M + 2 };
    expect(castRay([0, 0, 0.5], [1, 0, 0], [far])).toBeNull();
  });

  it("puts every hit of a sweep round the set on the ground or a prop's surface", () => {
    for (let k = 0; k < 40; k += 1) {
      for (const ray of sweepFan(k * 0.05, 0.3)) {
        const hit = castRay([2.6, 0, 0.5], ray, DEMO_PROPS);
        if (!hit) continue;
        const onGround = Math.abs(hit[2]) < 1e-6;
        const onProp = DEMO_PROPS.some(
          (p) =>
            Math.abs(hit[0] - p.x) <= p.w / 2 + 1e-6 &&
            Math.abs(hit[1] - p.y) <= p.d / 2 + 1e-6 &&
            hit[2] <= p.h + 1e-6,
        );
        expect(onGround || onProp).toBe(true);
      }
    }
  });
});

describe("sweepFan", () => {
  it("is one fan of unit rays, under level to over it", () => {
    const fan = sweepFan(0, 0);
    expect(fan).toHaveLength(SWEEP_FAN);
    for (const [x, y, z] of fan) expect(Math.hypot(x, y, z)).toBeCloseTo(1);
    expect(fan[0][2]).toBeLessThan(0);
    expect(fan[SWEEP_FAN - 1][2]).toBeGreaterThan(0);
  });

  it("turns a full circle every turn of the head", () => {
    const a = sweepFan(0.2, 0)[0];
    const b = sweepFan(0.2 + SWEEP_TURN_S, 0)[0];
    expect(b[0]).toBeCloseTo(a[0]);
    expect(b[1]).toBeCloseTo(a[1]);
  });
});
