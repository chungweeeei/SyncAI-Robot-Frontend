import { describe, expect, it } from "vitest";

import { createDashedRibbon, dashPieces } from "@/lib/scene/path-ribbon";

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
