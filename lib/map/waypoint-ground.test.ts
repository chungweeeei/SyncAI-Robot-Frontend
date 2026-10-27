import { describe, expect, it } from "vitest";

import type { FloorBand } from "@/lib/map/floors";
import { floorGroundOf, groundUnder, placedGround, robotGround } from "@/lib/map/waypoint-ground";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

const O = OCTREE_KEY_ORIGIN;

/**
 * Two storeys over a 6×1 strip at 0.1 m: the ground floor whole at kz 0
 * (-0.45 m), 2F at kz 30 (2.55 m) over the first five columns but for a hole
 * at column 2, and a step up to kz 33 (2.85 m) at column 4.
 */
function site(): OccupiedVoxels {
  const cells: number[] = [];
  for (let x = 0; x < 6; x += 1) cells.push(x, 0, 0);
  cells.push(0, 0, 30, 1, 0, 30, 3, 0, 30, 4, 0, 33);
  return {
    res: 0.1,
    keyMin: [O, O, O - 5],
    size: [6, 1, 34],
    keys: Uint16Array.from(cells),
    count: cells.length / 3,
    leaves: { occupied: cells.length / 3, free: 0 },
  };
}

const GROUND: FloorBand = { name: "1F", level: 0, lo: -Infinity, hi: 2 };
const UPSTAIRS: FloorBand = { name: "2F", level: 3, lo: 2, hi: 4.5 };
/** The centre of column x, in the world. */
const at = (x: number) => [(x + 0.5) * 0.1, 0.05] as const;
const xy = (x: number) => ({ x: at(x)[0], y: at(x)[1] });

/**
 * One storey over a 10×1 strip at 0.1 m, falling 0.2 m a column from kz 10
 * (-0.45 m) at column 0 to kz 0 (-1.45 m) at column 5 and level beyond, with
 * column 9 never seen.
 */
function slope(): OccupiedVoxels {
  const cells: number[] = [];
  for (let x = 0; x < 9; x += 1) cells.push(x, 0, 10 - 2 * Math.min(x, 5));
  return {
    res: 0.1,
    keyMin: [O, O, O - 15],
    size: [10, 1, 11],
    keys: Uint16Array.from(cells),
    count: cells.length / 3,
    leaves: { occupied: cells.length / 3, free: 0 },
  };
}

describe("placedGround", () => {
  it("puts a new stop with no floor picked on the ground floor, 0", () => {
    expect(placedGround({ voxels: site(), band: null, hasFloors: true, x: at(1)[0], y: at(1)[1] })).toBe(0);
    expect(placedGround({ voxels: null, band: null, hasFloors: true, x: 0, y: 0 })).toBe(0);
  });

  it("keeps a re-placed stop on its own floor when none is picked", () => {
    expect(
      placedGround({ voxels: site(), band: null, hasFloors: true, x: at(1)[0], y: at(1)[1], moving: 2.55 }),
    ).toBe(2.55);
  });

  it("stands a stop on a picked floor at the ground under it, step included", () => {
    expect(placedGround({ voxels: site(), band: UPSTAIRS, hasFloors: true, x: at(1)[0], y: at(1)[1] })).toBeCloseTo(
      2.55,
    );
    expect(placedGround({ voxels: site(), band: UPSTAIRS, hasFloors: true, x: at(4)[0], y: at(4)[1] })).toBeCloseTo(
      2.85,
    );
  });

  it("stands a stop on a map with no floors at the ground under it, however it slopes", () => {
    // One storey falling away from the origin: the planner looks for the
    // ground a metre either side of the stop's z, so 0 was out of its reach.
    expect(placedGround({ voxels: slope(), band: null, hasFloors: false, ...xy(5) })).toBeCloseTo(
      -1.45,
    );
    // A re-place has no other storey to keep it on.
    expect(
      placedGround({ voxels: slope(), band: null, hasFloors: false, ...xy(5), moving: 0 }),
    ).toBeCloseTo(-1.45);
  });

  it("keeps a 2D map's stops, which have no ground to read, at 0", () => {
    expect(placedGround({ voxels: null, band: null, hasFloors: false, x: 0, y: 0 })).toBe(0);
  });

  it("follows the picked floor over the stop's own height on a re-place", () => {
    expect(
      placedGround({ voxels: site(), band: UPSTAIRS, hasFloors: true, x: at(1)[0], y: at(1)[1], moving: 0 }),
    ).toBeCloseTo(2.55);
  });
});

describe("groundUnder", () => {
  it("falls back to the floor's own ground over a hole", () => {
    // The median of 2F's columns (30, 30, 30, 33) is kz 30.
    expect(groundUnder(site(), UPSTAIRS, ...at(2))).toBeCloseTo(2.55);
  });

  it("falls back to a body height under the level before the tree has loaded", () => {
    expect(groundUnder(null, UPSTAIRS, ...at(1))).toBeCloseTo(3 - 0.48);
  });
});

describe("floorGroundOf", () => {
  it("answers 0 for the ground floor whatever the tree says", () => {
    expect(floorGroundOf(site(), GROUND)).toBe(0);
    expect(floorGroundOf(site(), null)).toBe(0);
  });
});

describe("robotGround", () => {
  it("stands a stop under the robot on the floor its body height is in", () => {
    const pose = { x: at(4)[0], y: at(4)[1] };
    expect(robotGround(site(), [GROUND, UPSTAIRS], { ...pose, z: 3.3 })).toBeCloseTo(2.85);
    expect(robotGround(site(), [GROUND, UPSTAIRS], { ...pose, z: 0 })).toBeCloseTo(-0.45);
  });

  it("stands it on the ground under the robot on a map with no floors", () => {
    expect(robotGround(slope(), [], { ...xy(5), z: -1.45 + 0.48 })).toBeCloseTo(-1.45);
    // Over a hole, a body height under it.
    expect(robotGround(slope(), [], { ...xy(9), z: 0 })).toBeCloseTo(-0.48);
  });

  it("puts it on the ground floor on a 2D map", () => {
    expect(robotGround(null, [], { ...xy(4), z: 3.3 })).toBe(0);
  });
});
