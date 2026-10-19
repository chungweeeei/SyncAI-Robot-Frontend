import { describe, expect, it } from "vitest";

import { GROUND_FLOOR_Z_M } from "@/lib/map/floors";
import { createDashedRibbon, createPathRibbon, dashPieces } from "@/lib/scene/path-ribbon";
import { THEMES } from "@/lib/scene/theme";

/** A route as the telemetry stream hands it over: flat [x, y, z] triples. */
const route = (...points: [number, number, number][]) => Float32Array.from(points.flat());

/** Ground floor, a stair, the floor three metres up. */
const upTheStair = route([0, 0, 0], [1, 0, 0], [2, 0, 1.5], [3, 0, 3], [4, 0, 3]);

const heightsOf = (ribbon: NonNullable<ReturnType<typeof createPathRibbon>>) => {
  const position = ribbon.mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => +position.getZ(i).toFixed(3));
};

/** The ground floor's band, just over the floor plan. */
const onGround = +(GROUND_FLOOR_Z_M + 0.012).toFixed(3);

/** How many segments are drawn: two triangles, six indices, each. */
const segmentsOf = (ribbon: NonNullable<ReturnType<typeof createPathRibbon>>) =>
  ribbon.mesh.geometry.getIndex()!.count / 6;

describe("createPathRibbon", () => {
  it("lays each stretch on its own ground, just over it", () => {
    const ribbon = createPathRibbon(upTheStair, THEMES.light)!;
    // Two vertices per point, both at the point's ground plus the lift; the
    // ground floor's 0 is its real ground, where the floor plan is drawn.
    expect(heightsOf(ribbon)).toEqual([
      onGround, onGround, onGround, onGround, 1.512, 1.512, 3.012, 3.012, 3.012, 3.012,
    ]);
    expect(segmentsOf(ribbon)).toBe(4);
  });

  it("never goes under the floor plan", () => {
    // A planner's ground a few centimetres under the floor plan is still the
    // ground floor; under the plan, the route would be hidden.
    const under = GROUND_FLOOR_Z_M - 0.05;
    const ribbon = createPathRibbon(route([0, 0, under], [1, 0, under]), THEMES.light)!;
    expect(heightsOf(ribbon).every((z) => z === onGround)).toBe(true);
  });

  it("draws only the floor shown, and the whole route again with none", () => {
    const ribbon = createPathRibbon(upTheStair, THEMES.light)!;

    ribbon.setBand(-Infinity, 1.0); // the ground floor: its one segment
    expect(segmentsOf(ribbon)).toBe(1);

    ribbon.setBand(2.0, 4.5); // upstairs: its one segment
    expect(segmentsOf(ribbon)).toBe(1);

    ribbon.setBand(5.0, 8.0); // a floor the route never reaches
    expect(segmentsOf(ribbon)).toBe(0);

    ribbon.setBand(-Infinity, Infinity);
    expect(segmentsOf(ribbon)).toBe(4);
  });

  it("drops a segment with one end off the floor shown", () => {
    // The stair's middle point is on neither floor's band here, so neither
    // segment touching it is drawn — not half a stair hanging off a floor.
    const ribbon = createPathRibbon(upTheStair, THEMES.light)!;
    ribbon.setBand(-Infinity, 1.0);
    const index = Array.from(ribbon.mesh.geometry.getIndex()!.array);
    expect(Math.max(...index)).toBe(3); // the vertices of points 0 and 1 only
  });

  it("puts no NaN in the buffer for a step straight up", () => {
    // A NaN anywhere in a position buffer blanks the whole mesh.
    const ribbon = createPathRibbon(route([1, 1, 0], [1, 1, 0.17]), THEMES.light)!;
    const position = ribbon.mesh.geometry.getAttribute("position").array as Float32Array;
    expect(Array.from(position).some(Number.isNaN)).toBe(false);
  });

  it("makes nothing of a single point", () => {
    expect(createPathRibbon(route([1, 1, 0]), THEMES.light)).toBeNull();
  });
});

const length = ([ax, ay, bx, by]: number[]) => Math.hypot(bx - ax, by - ay);

describe("dashPieces", () => {
  it("never runs a dash past the end of the line", () => {
    // A dock's approach ends on the dock; a dash poking past it would draw
    // onto the charger as if the robot were meant to walk through it.
    for (const end of [0.05, 0.3, 1, 1.07]) {
      const pieces = dashPieces([0, 0, end, 0]);
      for (const piece of pieces) {
        expect(piece[2]).toBeLessThanOrEqual(end + 1e-9);
        expect(length(piece)).toBeGreaterThan(0);
      }
    }
  });

  it("starts on the first point", () => {
    const [first] = dashPieces([2, 3, 4, 3]);
    expect(first![0]).toBe(2);
    expect(first![1]).toBe(3);
  });

  it("carries the dash across a bend instead of restarting it", () => {
    // 0.1 m then a turn: the 0.12 m dash has 0.02 m left to run on the second
    // leg. Restarting per segment would draw a full dash there instead.
    const pieces = dashPieces([0, 0, 0.1, 0, 0.1, 1], 0.12, 0.08);
    expect(length(pieces[0]!)).toBeCloseTo(0.1);
    expect(length(pieces[1]!)).toBeCloseTo(0.02);
    // And the next dash starts a gap later, at 0.2 m along the whole line.
    expect(pieces[2]![1]).toBeCloseTo(0.1);
  });

  it("draws nothing for a line with no length", () => {
    expect(dashPieces([1, 1, 1, 1])).toEqual([]);
    expect(dashPieces([1, 1])).toEqual([]);
    expect(createDashedRibbon([1, 1, 1, 1], 0xffffff)).toBeNull();
  });
});

describe("dashPieces over a route's triples", () => {
  it("walks x and y and steps over z", () => {
    // A dock's approach arrives as a PlannedPath, three numbers a point.
    const pieces = dashPieces([0, 0, 0, 1, 0, 0], 0.12, 0.08, 3);
    expect(pieces[0]).toEqual([0, 0, 0.12, 0]);
    expect(pieces.at(-1)![2]).toBeLessThanOrEqual(1 + 1e-9);
  });
});
