import { describe, expect, it } from "vitest";

import {
  FLOOR_BAND_ABOVE_M,
  FLOOR_BAND_BELOW_M,
  FLOOR_GROUND_BELOW_LEVEL_M,
  floorBands,
  floorGround,
  floorOfHeight,
  floorsProblem,
  nextFloor,
  sameFloors,
} from "@/lib/map/floors";

const TWO = [
  { name: "2F", level: 5.5 },
  { name: "1F", level: -0.2 },
];

describe("floorBands", () => {
  it("cuts each floor under its ceiling, lowest floor first", () => {
    const bands = floorBands(TWO);
    expect(bands.map((band) => band.name)).toEqual(["1F", "2F"]);
    expect(bands[0].lo).toBe(-Infinity);
    // Two metres over the ground, give or take: the walls, not the ceiling
    // that would hide the floor from above.
    expect(bands[0].hi).toBeCloseTo(-0.2 + FLOOR_BAND_ABOVE_M);
    expect(bands[1].hi).toBeCloseTo(5.5 + FLOOR_BAND_ABOVE_M);
  });

  it("ends a floor where the next one starts when the storeys are low", () => {
    const [first, second] = floorBands([
      { name: "1F", level: 0 },
      { name: "M", level: 2 },
    ]);
    expect(first.hi).toBe(second.lo);
  });

  it("starts a floor under its level, so its ground is not the floor below's ceiling", () => {
    const [first, second] = floorBands(TWO);
    expect(second.lo).toBeCloseTo(5.5 - FLOOR_BAND_BELOW_M);
    // The ground the robot walks on, half a metre under the body, is in 2F.
    expect(5.5 - 0.5).toBeGreaterThanOrEqual(second.lo);
    expect(5.5 - 0.5).toBeGreaterThanOrEqual(first.hi);
  });

  it("gives one floor the whole map", () => {
    expect(floorBands([{ name: "1F", level: 0 }])).toEqual([
      { name: "1F", level: 0, lo: -Infinity, hi: Infinity },
    ]);
  });
});

describe("floorsProblem", () => {
  it("passes a list the backend saves", () => {
    expect(floorsProblem(TWO)).toBeNull();
    expect(floorsProblem([])).toBeNull();
  });

  it("refuses what the backend refuses, in its words", () => {
    expect(floorsProblem([{ name: " ", level: 0 }])).toBe("Every floor needs a name.");
    expect(floorsProblem([{ name: "x".repeat(17), level: 0 }])).toMatch(/too long/);
    expect(
      floorsProblem([
        { name: "1F", level: 0 },
        { name: "1f", level: 5 },
      ]),
    ).toBe("Two floors are called '1f'.");
    expect(
      floorsProblem([
        { name: "1F", level: 0 },
        { name: "M", level: 0.5 },
      ]),
    ).toBe("Floors '1F' and 'M' are less than 1 m apart.");
    expect(floorsProblem([{ name: "1F", level: Number.NaN }])).toMatch(/no height/);
  });
});

describe("nextFloor", () => {
  it("offers a storey above the top floor, under the next free name", () => {
    expect(nextFloor(TWO)).toEqual({ name: "3F", level: 8.5 });
    expect(nextFloor([])).toEqual({ name: "1F", level: 0 });
    expect(nextFloor([{ name: "2F", level: 0 }])).toEqual({ name: "3F", level: 3 });
  });

  it("never offers a name already taken", () => {
    const floors = [
      { name: "B1", level: -3 },
      { name: "3F", level: 0 },
    ];
    expect(nextFloor(floors).name).toBe("4F");
  });
});

describe("sameFloors", () => {
  it("ignores order but not a rename or a move", () => {
    expect(sameFloors(TWO, [...TWO].reverse())).toBe(true);
    expect(sameFloors(TWO, [TWO[0], { name: "G", level: -0.2 }])).toBe(false);
    expect(sameFloors(TWO, [TWO[0], { name: "1F", level: 0 }])).toBe(false);
  });
});

describe("floorGround", () => {
  const [first, second] = floorBands(TWO);

  it("keeps the lowest floor at 0, where every waypoint stood before floors", () => {
    // Even with a measured ground: a ground-floor goal must stay the request a
    // backend without floors took, which sends no height at all.
    expect(floorGround(first, -0.45)).toBe(0);
    expect(floorGround(null)).toBe(0);
  });

  it("puts an upper floor where the 3D map shows its ground, else a body height under its level", () => {
    expect(floorGround(second, 5.05)).toBe(5.05);
    expect(floorGround(second)).toBeCloseTo(5.5 - FLOOR_GROUND_BELOW_LEVEL_M);
  });
});

describe("floorOfHeight", () => {
  it("finds the floor a waypoint placed on it is on, by the bands the 3D map is drawn in", () => {
    for (const band of floorBands(TWO)) {
      expect(floorOfHeight(floorGround(band), TWO)).toBe(band.name);
    }
  });

  it("names no floor on a map of one storey", () => {
    expect(floorOfHeight(0, [])).toBeNull();
  });
});
