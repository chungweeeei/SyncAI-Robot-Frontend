import { describe, expect, it } from "vitest";

import {
  GroundStroke,
  NO_FLOOR,
  applyGroundPatch,
  cellOf,
  clearanceCells,
  columnFloors,
  columnOf,
  createGroundSession,
  eraseDab,
  fillDab,
  fromFillKeys,
  bandForHeights,
  fullBand,
  groundMeta,
  isHole,
  kzToMetres,
  localFloor,
  metresToKz,
  sameEdits,
  setGroundBand,
  toFillKeys,
  type GroundEdits,
} from "@/lib/map/ground-fill";
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

  it("rounds the clearance up to whole cells", () => {
    expect(clearanceCells(0.1)).toBe(6);
    expect(clearanceCells(0.25)).toBe(3);
  });
});

describe("localFloor", () => {
  it("is the median of the floor around the dab", () => {
    const floors = columnFloors(site(), fullBand(site()));
    expect(localFloor(floors, new Map(), 3, 3, 3)).toBe(0);
  });

  it("refuses with too few cells to read", () => {
    const voxels: OccupiedVoxels = {
      ...site(),
      keys: Uint16Array.from([0, 0, 0, 1, 0, 0]),
      count: 2,
    };
    const floors = columnFloors(voxels, fullBand(voxels));
    expect(localFloor(floors, new Map(), 3, 3, 3)).toBeNull();
  });

  it("counts earlier patches as floor, so a fill can grow across a wide hole", () => {
    const floors = columnFloors(site(), fullBand(site()));
    // Nothing within one cell of the hole's centre but the hole itself…
    expect(localFloor(floors, new Map(), 3, 3, 1)).toBeNull();
    // …until the ring around it has been patched.
    const edits: GroundEdits = new Map([
      [index(2, 2), 0],
      [index(3, 2), 0],
      [index(4, 2), 0],
      [index(2, 3), 0],
      [index(4, 3), 0],
    ]);
    expect(localFloor(floors, edits, 3, 3, 1)).toBe(0);
  });
});

describe("isHole", () => {
  it("is a column with nothing from the floor up through the clearance", () => {
    const floors = columnFloors(site(), fullBand(site()));
    expect(isHole(floors, index(3, 3), 0, 6)).toBe(true);
    // Floor already there.
    expect(isHole(floors, index(1, 1), 0, 6)).toBe(false);
    // The storey above is well clear of a ground-level fill.
    expect(isHole(floors, index(6, 6), 0, 6)).toBe(false);
    expect(isHole({ ...floors, floor: Int16Array.from([30]) }, 0, 0, 6)).toBe(true);
  });
});

describe("fillDab / eraseDab", () => {
  it("fills only the holes under the brush, at the surrounding floor's height", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();

    // A radius-1 disc is the 3×3 block (lib/map/grid.ts's stamp), which here
    // is exactly the hole.
    const changed = fillDab(session.floors, session.edits, stroke, 3, 3, 1, 10, 6);

    const hole: number[] = [];
    for (let y = 2; y <= 4; y += 1) for (let x = 2; x <= 4; x += 1) hole.push(index(x, y));
    expect(changed.sort((a, b) => a - b)).toEqual(hole.sort((a, b) => a - b));
    expect(session.edits.get(index(3, 3))).toBe(0);
    expect(stroke.size).toBe(9);
  });

  it("leaves existing floor alone and does not double-fill", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();
    // A dab on solid floor fills nothing.
    expect(fillDab(session.floors, session.edits, stroke, 0, 0, 1, 10, 6)).toEqual([]);
    expect(session.edits.size).toBe(0);
    // A brush wider than the hole fills the hole and nothing around it.
    fillDab(session.floors, session.edits, stroke, 3, 3, 3, 10, 6);
    const first = session.edits.size;
    expect(first).toBe(9);
    expect(fillDab(session.floors, session.edits, stroke, 3, 3, 3, 10, 6)).toEqual([]);
    expect(session.edits.size).toBe(first);
  });

  it("fills nothing where no floor can be read", () => {
    const voxels: OccupiedVoxels = { ...site(), keys: Uint16Array.from([0, 0, 0]), count: 1 };
    const session = createGroundSession(voxels, new Map());
    expect(fillDab(session.floors, session.edits, new GroundStroke(), 3, 3, 3, 10, 6)).toEqual([]);
  });

  it("erases only the operator's own patches", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();
    fillDab(session.floors, session.edits, stroke, 3, 3, 3, 10, 6);
    const patch = stroke.commit(session.edits);
    expect(patch?.cells.length).toBe(9);

    const erase = new GroundStroke();
    const changed = eraseDab(session.floors, session.edits, erase, 3, 3, 0);
    expect(changed).toEqual([index(3, 3)]);
    expect(session.edits.size).toBe(8);
    // The floor around it is not a patch, so it is not erased.
    expect(eraseDab(session.floors, session.edits, erase, 0, 6, 1)).toEqual([]);
  });

  it("commits a patch that undoes and redoes the stroke", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();
    fillDab(session.floors, session.edits, stroke, 3, 3, 1, 10, 6);
    const patch = stroke.commit(session.edits)!;
    expect(patch.cells.length).toBe(9);
    expect(patch.before.every((v) => v === NO_FLOOR)).toBe(true);
    expect(patch.after.every((v) => v === 0)).toBe(true);

    applyGroundPatch(session.edits, patch, "before");
    expect(session.edits.size).toBe(0);
    applyGroundPatch(session.edits, patch, "after");
    expect(session.edits.size).toBe(9);
  });

  it("commits nothing for a stroke that fills and erases the same cells", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();
    fillDab(session.floors, session.edits, stroke, 3, 3, 1, 10, 6);
    eraseDab(session.floors, session.edits, stroke, 3, 3, 1);
    expect(stroke.commit(session.edits)).toBeNull();
  });
});

describe("the record", () => {
  it("round-trips through absolute keys", () => {
    const voxels = site();
    const edits: GroundEdits = new Map([
      [index(3, 3), 0],
      [index(2, 4), 0],
    ]);
    const keys = toFillKeys(edits, voxels);
    expect(keys).toContainEqual([O + 13, O, O - 5]);
    expect(keys).toContainEqual([O + 12, O + 1, O - 5]);
    const back = fromFillKeys(keys, voxels);
    expect(back.skipped).toBe(0);
    expect(sameEdits(back.edits, edits)).toBe(true);
  });

  it("drops keys outside the tree's box and counts them", () => {
    const back = fromFillKeys(
      [
        [O + 13, O, O - 5],
        [O + 100, O, O - 5],
        [O + 13, O, O + 40],
      ],
      site(),
    );
    expect(back.edits.size).toBe(1);
    expect(back.skipped).toBe(2);
  });

  it("compares edit sets by their patches", () => {
    expect(sameEdits(new Map([[1, 0]]), new Map([[1, 0]]))).toBe(true);
    expect(sameEdits(new Map([[1, 0]]), new Map([[1, 1]]))).toBe(false);
    expect(sameEdits(new Map([[1, 0]]), new Map())).toBe(false);
  });
});

describe("the raster", () => {
  it("is a floor plan whose row 0 is the highest ky", () => {
    const meta = groundMeta(site());
    expect(meta.width).toBe(7);
    expect(meta.height).toBe(7);
    expect(meta.origin[0]).toBeCloseTo(1.0);
    expect(meta.origin[1]).toBeCloseTo(-0.3);
    const size = { width: 7, height: 7 };
    expect(columnOf(size, 0, 6)).toBe(index(0, 0));
    expect(columnOf(size, 3, 0)).toBe(index(3, 6));
    expect(cellOf(size, index(3, 6))).toEqual({ col: 3, row: 0 });
  });

  it("rebuilds the floors when the band moves", () => {
    const session = createGroundSession(site(), new Map());
    expect(session.floors.floor[index(6, 6)]).toBe(0);
    setGroundBand(session, { lo: 20, hi: 30 });
    expect(session.floors.floor[index(6, 6)]).toBe(30);
    expect(session.band).toEqual({ lo: 20, hi: 30 });
  });
});
