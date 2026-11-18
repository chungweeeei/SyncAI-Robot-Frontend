import { describe, expect, it } from "vitest";

import {
  MAP_SURFACE_REACH_M,
  OVER_MAP_LIFT_M,
  standsOnMap,
  type SurfaceTop,
} from "@/lib/scene/map-surface";

describe("standsOnMap", () => {
  it("stands a mark half a cell over the floor's top face, clear of the cells drawn round it", () => {
    // dp's 2F (2026-11-17): a waypoint's z of 5.15 m under a floor topping
    // out at 5.30 m, whose cells are drawn reaching half a cell over it.
    const floorAt530: SurfaceTop = () => 5.3;

    expect(standsOnMap(1, 2, 5.15, floorAt530)).toBeCloseTo(5.35);
    expect(OVER_MAP_LIFT_M).toBeCloseTo(0.05);
  });

  it("looks for the floor at the point asked about, near the mark's own ground", () => {
    const asked: [number, number, number, number][] = [];
    const recordingSurfaceTop: SurfaceTop = (wx, wy, z, reach) => {
      asked.push([wx, wy, z, reach]);
      return 0;
    };

    standsOnMap(1.5, -2.25, 5.15, recordingSurfaceTop);

    expect(asked).toEqual([[1.5, -2.25, 5.15, MAP_SURFACE_REACH_M]]);
  });

  it("keeps a reach short of the next floor or a table top", () => {
    // A cell under the top face at best and another under that, in a 0.1 m
    // tree; a storey is metres.
    expect(MAP_SURFACE_REACH_M).toBeGreaterThanOrEqual(0.2);
    expect(MAP_SURFACE_REACH_M).toBeLessThan(0.5);
  });

  it("keeps the mark's own ground with no tree drawn or no floor in reach", () => {
    const noFloorInReach: SurfaceTop = () => null;

    expect(standsOnMap(0, 0, 5.15, null)).toBe(5.15);
    expect(standsOnMap(0, 0, 5.15, noFloorInReach)).toBe(5.15);
  });

  it("answers one of exactly two heights, over many random marks and floors", () => {
    // Seeded, so a failure names the same case on every run.
    let seed = 20261118;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };

    for (let caseIndex = 0; caseIndex < 10_000; caseIndex++) {
      const ground = (random() - 0.5) * 20;
      const floorTop = random() < 0.3 ? null : ground + (random() - 0.5) * 2 * MAP_SURFACE_REACH_M;
      const surfaceTop: SurfaceTop | null =
        random() < 0.1 ? null : () => floorTop;
      const height = standsOnMap(random() * 100, random() * 100, ground, surfaceTop);

      expect(Number.isFinite(height)).toBe(true);
      if (surfaceTop === null || floorTop === null) {
        expect(height).toBe(ground);
      } else {
        expect(height).toBeCloseTo(floorTop + OVER_MAP_LIFT_M, 9);
      }
    }
  });
});
