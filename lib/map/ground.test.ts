import { describe, expect, it } from "vitest";

import {
  NO_FLOOR,
  bandForHeights,
  columnAt,
  columnFloors,
  floorHeightIn,
  fullBand,
  groundAt,
  kzToMetres,
  medianFloor,
  metresToKz,
} from "@/lib/map/ground";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

const O = OCTREE_KEY_ORIGIN;

/**
 * A 7×7 floor one cell thick at relative kz 0, with the centre 3×3 missing
 * (a hole), a wall two cells high standing on (0, 0), and a second storey
 * at kz 30 over the far corner. keyMin is the origin shifted, so absolute
 * keys and relative ones differ.
 */
function site(): OccupiedVoxels {
  const cells: number[] = [];
  for (let y = 0; y < 7; y += 1) {
    for (let x = 0; x < 7; x += 1) {
      const hole = x >= 2 && x <= 4 && y >= 2 && y <= 4;
      if (!hole) cells.push(x, y, 0);
    }
  }
  cells.push(0, 0, 1, 0, 0, 2); // the wall
  cells.push(6, 6, 30, 5, 6, 30); // the storey above
  return {
    res: 0.1,
    keyMin: [O + 10, O - 3, O - 5],
    size: [7, 7, 31],
    keys: Uint16Array.from(cells),
    count: cells.length / 3,
    leaves: { occupied: cells.length / 3, free: 0 },
  };
}

const index = (x: number, y: number) => x + y * 7;

describe("columnFloors", () => {
  it("takes the lowest cell in the band per column, and none for a hole", () => {
    const floors = columnFloors(site(), fullBand(site()));
    expect(floors.floor[index(0, 0)]).toBe(0);
    expect(floors.floor[index(1, 1)]).toBe(0);
    expect(floors.floor[index(3, 3)]).toBe(NO_FLOOR);
    expect(floors.floor[index(6, 6)]).toBe(0);
  });

  it("reads one storey when the band excludes the other", () => {
    const upper = columnFloors(site(), { lo: 20, hi: 30 });
    expect(upper.floor[index(6, 6)]).toBe(30);
    expect(upper.floor[index(0, 0)]).toBe(NO_FLOOR);
  });
});

describe("floorHeightIn", () => {
  it("finds each storey's ground, in metres, from the heights it owns", () => {
    expect(floorHeightIn(site(), -Infinity, 2)).toBeCloseTo(-0.45);
    expect(floorHeightIn(site(), 2, Infinity)).toBeCloseTo(2.55);
  });

  it("has no answer for heights the tree has no cell in", () => {
    expect(floorHeightIn(site(), 1, 2)).toBeNull();
  });
});

describe("groundAt", () => {
  // The centre of column (x, y) in the world: keyMin is shifted, so the
  // relative column x starts at world x (x + 10) * 0.1 and y at (y - 3) * 0.1.
  const at = (x: number, y: number) => [(x + 10.5) * 0.1, (y - 2.5) * 0.1] as const;

  it("reads the ground under the point", () => {
    expect(groundAt(site(), ...at(1, 1), -Infinity, 2)).toBeCloseTo(-0.45);
  });

  it("takes each storey's own ground in a column both are over", () => {
    expect(groundAt(site(), ...at(6, 6), -Infinity, 2)).toBeCloseTo(-0.45);
    expect(groundAt(site(), ...at(6, 6), 2, Infinity)).toBeCloseTo(2.55);
  });

  it("stands on a wall's foot, not its top", () => {
    expect(groundAt(site(), ...at(0, 0), -Infinity, Infinity)).toBeCloseTo(-0.45);
  });

  it("has no answer over a hole, off the tree or outside the heights", () => {
    expect(groundAt(site(), ...at(3, 3), -Infinity, Infinity)).toBeNull();
    expect(groundAt(site(), 50, 50, -Infinity, Infinity)).toBeNull();
    expect(groundAt(site(), ...at(1, 1), 2, Infinity)).toBeNull();
  });
});

describe("band conversions", () => {
  it("round-trips metres through a relative kz", () => {
    const voxels = site();
    expect(kzToMetres(0, voxels)).toBeCloseTo(-0.45);
    expect(metresToKz(-0.45, voxels)).toBe(0);
    expect(metresToKz(kzToMetres(30, voxels), voxels)).toBe(30);
  });

  it("turns a floor's heights into the levels whose centres lie in them", () => {
    const voxels = site();
    const full = fullBand(voxels);
    expect(bandForHeights(voxels, -Infinity, Infinity)).toEqual(full);
    // Centres at -0.45 + 0.1k: [-0.45, 2.55) is levels 0..29, the top one out.
    expect(bandForHeights(voxels, -0.45, 2.55)).toEqual({ lo: 0, hi: 29 });
    expect(bandForHeights(voxels, 2.5, Infinity)).toEqual({ lo: 30, hi: full.hi });
    // A band the tree does not reach.
    expect(bandForHeights(voxels, 100, 101)).toBeNull();
  });

});

describe("the floor a view is framed on", () => {
  it("aims at the floor most columns stand on, not a wall or the storey above", () => {
    const voxels = site();
    expect(medianFloor(columnFloors(voxels, fullBand(voxels)))).toBe(0);
    // Only the storey above in the band: its floor.
    expect(medianFloor(columnFloors(voxels, { lo: 30, hi: 30 }))).toBe(30);
    expect(medianFloor(columnFloors(voxels, { lo: 10, hi: 20 }))).toBeNull();
  });
});

describe("columnAt", () => {
  it("finds the column under a map-frame point, in the tree's key order", () => {
    const voxels = site(); // keyMin x O+10, y O-3; 0.1 m cells
    expect(columnAt(voxels, 1.05, -0.25)).toEqual({ x: 0, y: 0 });
    expect(columnAt(voxels, 1.25, 0.05)).toEqual({ x: 2, y: 3 });
    expect(columnAt(voxels, 0.95, 0)).toBeNull();
    expect(columnAt(voxels, 1.75, 0)).toBeNull();
  });
});
