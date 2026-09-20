import { describe, expect, it } from "vitest";

import {
  FREE,
  OCCUPIED,
  UNKNOWN,
  cellIndex,
  classify,
  countValues,
  inBounds,
  stampDisc,
  stampLine,
  stampRect,
  type GridSize,
  type GridValue,
  type MapGrid,
} from "@/lib/map/grid";

const size: GridSize = { width: 9, height: 7 };

/** Collect what a stamp would write, as `row,col` strings for readable diffs. */
function stamped(
  run: (sink: (index: number, value: GridValue) => void) => void,
  within: GridSize = size,
): string[] {
  const seen = new Set<string>();
  run((index) => {
    seen.add(`${Math.floor(index / within.width)},${index % within.width}`);
  });
  return [...seen].sort();
}

/** A stamp rendered as ASCII, so a shape regression reads as a shape. */
function picture(
  run: (sink: (index: number, value: GridValue) => void) => void,
): string {
  const on = new Set<number>();
  run((index) => on.add(index));
  const rows: string[] = [];
  for (let row = 0; row < size.height; row += 1) {
    let line = "";
    for (let col = 0; col < size.width; col += 1) {
      line += on.has(cellIndex(size, col, row)) ? "#" : ".";
    }
    rows.push(line);
  }
  return rows.join("\n");
}

describe("classify", () => {
  it("splits the .pgm byte range the way the loader does", () => {
    expect(classify(0)).toBe(OCCUPIED);
    expect(classify(89)).toBe(OCCUPIED);
    expect(classify(90)).toBe(UNKNOWN);
    expect(classify(205)).toBe(UNKNOWN);
    expect(classify(206)).toBe(FREE);
    expect(classify(255)).toBe(FREE);
  });

  it("puts the three canonical values in their own bucket", () => {
    // 205 in particular: lib/api/map.ts turns off colour management on the PNG
    // decode precisely so this byte survives, and a 204 would read as UNKNOWN
    // too — but a 206 would not, which is the drift that check protects.
    expect(classify(OCCUPIED)).toBe(OCCUPIED);
    expect(classify(UNKNOWN)).toBe(UNKNOWN);
    expect(classify(FREE)).toBe(FREE);
  });
});

describe("cellIndex / inBounds", () => {
  it("indexes row-major", () => {
    expect(cellIndex(size, 0, 0)).toBe(0);
    expect(cellIndex(size, 8, 0)).toBe(8);
    expect(cellIndex(size, 0, 1)).toBe(9);
  });

  it("rejects every off-grid coordinate", () => {
    expect(inBounds(size, 0, 0)).toBe(true);
    expect(inBounds(size, 8, 6)).toBe(true);
    expect(inBounds(size, -1, 0)).toBe(false);
    expect(inBounds(size, 9, 0)).toBe(false);
    expect(inBounds(size, 0, 7)).toBe(false);
  });
});

describe("stampDisc", () => {
  it("paints exactly one cell at diameter 1", () => {
    expect(stamped((sink) => stampDisc(size, 4, 3, 1, FREE, sink))).toEqual([
      "3,4",
    ]);
  });

  it("paints a full 3x3 at diameter 3, not a plus sign", () => {
    // The `r*r + r` fudge exists for this: a plain radius test renders a plus,
    // which reads as a bug the first time someone paints with the small brush.
    expect(picture((sink) => stampDisc(size, 4, 3, 3, FREE, sink))).toBe(
      [
        ".........",
        ".........",
        "...###...",
        "...###...",
        "...###...",
        ".........",
        ".........",
      ].join("\n"),
    );
  });

  it("is a recognisable disc from diameter 7 up", () => {
    expect(picture((sink) => stampDisc(size, 4, 3, 7, FREE, sink))).toBe(
      [
        "...###...",
        "..#####..",
        ".#######.",
        ".#######.",
        ".#######.",
        "..#####..",
        "...###...",
      ].join("\n"),
    );
  });

  it("clips at every edge instead of wrapping to the next row", () => {
    // The failure this guards is the one that looks like a bug and is not
    // obviously one: an unclipped index spills into row+1 and paints a stripe
    // on the far side of the map.
    const corner = stamped((sink) => stampDisc(size, 0, 0, 7, FREE, sink));
    expect(corner.every((key) => !key.startsWith("-"))).toBe(true);
    for (const key of corner) {
      const [row, col] = key.split(",").map(Number);
      expect(inBounds(size, col, row)).toBe(true);
    }
    expect(corner).not.toContain("0,8");
  });
});

describe("stampLine", () => {
  it("leaves a continuous trail with no gaps", () => {
    // What a fast flick at high zoom depends on: without interpolation between
    // two pointer samples the stroke comes out dashed.
    const cells = new Set<number>();
    stampLine(size, { col: 0, row: 0 }, { col: 8, row: 6 }, 1, FREE, (index) =>
      cells.add(index),
    );
    const rowsTouched = new Set(
      [...cells].map((index) => Math.floor(index / size.width)),
    );
    expect(rowsTouched.size).toBe(size.height);
    expect(cells.has(cellIndex(size, 0, 0))).toBe(true);
    expect(cells.has(cellIndex(size, 8, 6))).toBe(true);
  });

  it("is the same set of cells drawn either way round", () => {
    const forward = stamped((sink) =>
      stampLine(size, { col: 1, row: 1 }, { col: 7, row: 5 }, 3, FREE, sink),
    );
    const backward = stamped((sink) =>
      stampLine(size, { col: 7, row: 5 }, { col: 1, row: 1 }, 3, FREE, sink),
    );
    expect(forward).toEqual(backward);
  });

  it("degenerates to one disc when both ends coincide", () => {
    const line = stamped((sink) =>
      stampLine(size, { col: 4, row: 3 }, { col: 4, row: 3 }, 3, FREE, sink),
    );
    const disc = stamped((sink) => stampDisc(size, 4, 3, 3, FREE, sink));
    expect(line).toEqual(disc);
  });
});

describe("stampRect", () => {
  it("fills the rectangle whichever corners it is given", () => {
    const a = stamped((sink) =>
      stampRect(size, { col: 2, row: 1 }, { col: 4, row: 3 }, FREE, sink),
    );
    const b = stamped((sink) =>
      stampRect(size, { col: 4, row: 3 }, { col: 2, row: 1 }, FREE, sink),
    );
    expect(a).toEqual(b);
    expect(a).toHaveLength(9);
  });

  it("clips to the grid rather than indexing outside it", () => {
    const cells = stamped((sink) =>
      stampRect(size, { col: -5, row: -5 }, { col: 99, row: 99 }, FREE, sink),
    );
    expect(cells).toHaveLength(size.width * size.height);
  });
});

describe("countValues", () => {
  it("counts by classification, not by raw byte", () => {
    const grid: MapGrid = {
      width: 4,
      height: 1,
      data: new Uint8Array([0, 128, 205, 254]),
    };
    expect(countValues(grid)).toEqual({ occupied: 1, unknown: 2, free: 1 });
  });

  it("totals every cell", () => {
    const grid: MapGrid = {
      width: 10,
      height: 10,
      data: new Uint8Array(100).fill(UNKNOWN),
    };
    const counts = countValues(grid);
    expect(counts.occupied + counts.unknown + counts.free).toBe(100);
  });
});
