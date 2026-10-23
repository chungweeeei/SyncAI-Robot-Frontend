import { describe, expect, it } from "vitest";

import { columnStacks, fullBand, NO_FLOOR } from "@/lib/map/ground";
import {
  GroundStroke,
  aimSurface,
  applyGroundPatch,
  clearanceCells,
  createGroundSession,
  eraseDab,
  fillDab,
  fillReach,
  fromFillKeys,
  isHole,
  patchHeight,
  sameEdits,
  setGroundBand,
  toFillKeys,
  withGroundPatches,
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

/**
 * A straight flight from the ground floor up to a landing, rising along x:
 * the ground at kz 0 for x 0–2, four treads three columns deep and two
 * cells apart (kz 2, 4, 6, 8; each with its riser one cell under its front
 * column), and the landing at kz 10. From the third tread on the flight
 * stands over open ground (kz 0 again, x 9–17), and the flight above it in
 * a switchback crosses over the third tread at kz 22. The third tread has a
 * hole three columns long at x 10 and the fourth one cell at (13, 2); under
 * both the ground is seen, which is what made them unfillable.
 */
function stair(): OccupiedVoxels {
  const cells: number[] = [];
  const hole = (x: number, y: number) => (x === 10 && y >= 1 && y <= 3) || (x === 13 && y === 2);
  for (let y = 0; y < 5; y += 1) {
    for (let x = 0; x < 18; x += 1) {
      const step = Math.min(Math.floor(x / 3), 5);
      if (step === 0 || x >= 9) cells.push(x, y, 0);
      if (step > 0 && !hole(x, y)) {
        cells.push(x, y, 2 * step);
        if (x % 3 === 0) cells.push(x, y, 2 * step - 1);
      }
      if (x >= 9 && x <= 11) cells.push(x, y, 22);
    }
  }
  return {
    res: 0.1,
    keyMin: [O, O, O],
    size: [18, 5, 23],
    keys: Uint16Array.from(cells),
    count: cells.length / 3,
    leaves: { occupied: cells.length / 3, free: 0 },
  };
}

const stairIndex = (x: number, y: number) => x + y * 18;

/** The cell (x, y, z) in the stair's metres: its centre. */
const centre = (x: number, y: number, z: number) => ({
  x: (x + 0.5) * 0.1,
  y: (y + 0.5) * 0.1,
  z: (z + 0.5) * 0.1,
});

const reach = fillReach(0.1);

describe("fillReach", () => {
  it("rounds the clearance up to whole cells", () => {
    expect(clearanceCells(0.1)).toBe(6);
    expect(clearanceCells(0.25)).toBe(3);
  });

  it("reads within half a metre of the aim, and a hole is clear to 0.2 m under it", () => {
    expect(fillReach(0.1)).toEqual({ ring: 10, window: 5, depth: 2, clearance: 6 });
  });
});

describe("patchHeight", () => {
  it("is the height of the floor around the hole", () => {
    const voxels = site();
    expect(patchHeight(columnStacks(voxels), new Map(), 3, 3, 0, reach)).toBe(0);
  });

  it("refuses with too few cells to read", () => {
    const voxels: OccupiedVoxels = {
      ...site(),
      keys: Uint16Array.from([0, 0, 0, 1, 0, 0]),
      count: 2,
    };
    expect(patchHeight(columnStacks(voxels), new Map(), 3, 3, 0, reach)).toBeNull();
  });

  it("counts earlier patches as floor, so a fill can grow across a wide hole", () => {
    const stacks = columnStacks(site());
    const near = { ...reach, ring: 1 };
    // Nothing within one cell of the hole's centre but the hole itself…
    expect(patchHeight(stacks, new Map(), 3, 3, 0, near)).toBeNull();
    // …until the ring around it has been patched.
    const edits: GroundEdits = new Map([
      [index(2, 2), 0],
      [index(3, 2), 0],
      [index(4, 2), 0],
      [index(2, 3), 0],
      [index(4, 3), 0],
    ]);
    expect(patchHeight(stacks, edits, 3, 3, 0, near)).toBe(0);
  });

  it("takes the tread the hole is in, not the ground under the flight", () => {
    const stacks = columnStacks(stair());
    // The ground is in the hole's own column, half a metre down.
    expect(patchHeight(stacks, new Map(), 10, 2, 6, reach)).toBe(6);
  });

  it("takes each tread's own height, not the stair's mean", () => {
    const stacks = columnStacks(stair());
    // Aimed at the third tread, the fourth's hole is still within reach and
    // reads the fourth.
    expect(patchHeight(stacks, new Map(), 13, 2, 6, reach)).toBe(8);
  });

  it("does not read a wall as floor at the height the window cuts it", () => {
    // A wall three cells high in a hole's ring: only its top is a surface,
    // so a window around kz 1 reads the floor round it, not the wall's face.
    const voxels = site();
    const stacks = columnStacks(voxels);
    expect(patchHeight(stacks, new Map(), 1, 1, 1, { ...reach, ring: 1, window: 1 })).toBe(0);
  });
});

describe("isHole", () => {
  it("is a column with nothing from just under the patch up through the clearance", () => {
    const stacks = columnStacks(site());
    expect(isHole(stacks, index(3, 3), 0, reach)).toBe(true);
    // Floor already there.
    expect(isHole(stacks, index(1, 1), 0, reach)).toBe(false);
    // A cell or two under the patch is the floor, seen low.
    expect(isHole(stacks, index(1, 1), 2, reach)).toBe(false);
    // Further down is another surface.
    expect(isHole(stacks, index(1, 1), 3, reach)).toBe(true);
    // Something standing in the clearance.
    expect(isHole(stacks, index(0, 0), -2, reach)).toBe(false);
  });

  it("is a hole in a flight over the ground, and under the flight over it", () => {
    const stacks = columnStacks(stair());
    expect(isHole(stacks, stairIndex(10, 2), 6, reach)).toBe(true);
  });
});

describe("aimSurface", () => {
  const down = { x: 0, y: 0, z: -1 };

  it("aims at the rim of the hole the pointer is over, not what lies through it", () => {
    const voxels = stair();
    const stacks = columnStacks(voxels);
    // Straight down over the hole's middle, the shown band cut under the
    // flight overhead: the ray's own column holds only the ground.
    const { x, y } = centre(10, 2, 0);
    const ray = { origin: { x, y, z: 3 }, direction: down };
    expect(aimSurface(voxels, stacks, new Map(), { lo: 0, hi: 15 }, ray, 0.15)).toBe(6);
  });

  it("takes what is nearest the camera among the shown heights", () => {
    const voxels = stair();
    const stacks = columnStacks(voxels);
    const { x, y } = centre(10, 2, 0);
    const ray = { origin: { x, y, z: 3 }, direction: down };
    // The whole tree shown, the flight overhead hides the one under it.
    expect(aimSurface(voxels, stacks, new Map(), fullBand(voxels), ray, 0.15)).toBe(22);
  });

  it("does not take a wall's face", () => {
    const voxels = site();
    const stacks = columnStacks(voxels);
    // Level with the wall's middle cell, aimed straight at it: a face, with
    // the wall's top a cell over the ray and the floor a cell under.
    const ray = {
      origin: { x: 2, y: (0 - 3 + 0.5) * 0.1, z: (1 - 5 + 0.5) * 0.1 },
      direction: { x: -1, y: 0, z: 0 },
    };
    expect(aimSurface(voxels, stacks, new Map(), fullBand(voxels), ray, 0.05)).toBeNull();
    // A ray just over the wall finds its top.
    const over = { ...ray, origin: { ...ray.origin, z: (2 - 5 + 0.5) * 0.1 } };
    expect(aimSurface(voxels, stacks, new Map(), fullBand(voxels), over, 0.05)).toBe(2);
  });

  it("aims at a patch the way it aims at a floor", () => {
    const voxels = site();
    const stacks = columnStacks(voxels);
    const edits: GroundEdits = new Map([[index(3, 3), 0]]);
    const ray = {
      origin: { x: (3 + 10 + 0.5) * 0.1, y: (3 - 3 + 0.5) * 0.1, z: 3 },
      direction: down,
    };
    expect(aimSurface(voxels, stacks, new Map(), fullBand(voxels), ray, 0.05)).toBeNull();
    expect(aimSurface(voxels, stacks, edits, fullBand(voxels), ray, 0.05)).toBe(0);
  });
});

describe("fillDab / eraseDab", () => {
  it("fills only the holes under the brush, at the surrounding floor's height", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();

    // A radius-1 disc is the 3×3 block (lib/map/grid.ts's stamp), which here
    // is exactly the hole.
    const changed = fillDab(session.stacks, session.edits, stroke, 3, 3, 1, 0, reach);

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
    expect(fillDab(session.stacks, session.edits, stroke, 0, 0, 1, 0, reach)).toEqual([]);
    expect(session.edits.size).toBe(0);
    // A brush wider than the hole fills the hole and nothing around it.
    fillDab(session.stacks, session.edits, stroke, 3, 3, 3, 0, reach);
    const first = session.edits.size;
    expect(first).toBe(9);
    expect(fillDab(session.stacks, session.edits, stroke, 3, 3, 3, 0, reach)).toEqual([]);
    expect(session.edits.size).toBe(first);
  });

  it("fills nothing where no floor can be read", () => {
    const voxels: OccupiedVoxels = { ...site(), keys: Uint16Array.from([0, 0, 0]), count: 1 };
    const session = createGroundSession(voxels, new Map());
    expect(fillDab(session.stacks, session.edits, new GroundStroke(), 3, 3, 3, 0, reach)).toEqual(
      [],
    );
  });

  it("fills the holes in a flight over the ground, each at its own tread", () => {
    const session = createGroundSession(stair(), new Map());
    const stroke = new GroundStroke();
    // Aimed at the third tread, wide enough to take in the fourth's hole.
    const changed = fillDab(session.stacks, session.edits, stroke, 11, 2, 3, 6, reach);
    expect(changed.sort((a, b) => a - b)).toEqual(
      [stairIndex(10, 1), stairIndex(10, 2), stairIndex(13, 2), stairIndex(10, 3)].sort(
        (a, b) => a - b,
      ),
    );
    expect(session.edits.get(stairIndex(10, 2))).toBe(6);
    expect(session.edits.get(stairIndex(13, 2))).toBe(8);
  });

  it("erases only the operator's own patches", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();
    fillDab(session.stacks, session.edits, stroke, 3, 3, 3, 0, reach);
    const patch = stroke.commit(session.edits);
    expect(patch?.cells.length).toBe(9);

    const erase = new GroundStroke();
    const changed = eraseDab(session.size, session.edits, erase, 3, 3, 0);
    expect(changed).toEqual([index(3, 3)]);
    expect(session.edits.size).toBe(8);
    // The floor around it is not a patch, so it is not erased.
    expect(eraseDab(session.size, session.edits, erase, 0, 6, 1)).toEqual([]);
  });

  it("commits a patch that undoes and redoes the stroke", () => {
    const session = createGroundSession(site(), new Map());
    const stroke = new GroundStroke();
    fillDab(session.stacks, session.edits, stroke, 3, 3, 1, 0, reach);
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
    fillDab(session.stacks, session.edits, stroke, 3, 3, 1, 0, reach);
    eraseDab(session.size, session.edits, stroke, 3, 3, 1);
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

  it("draws the saved patches into the tree, once each", () => {
    const voxels = site();
    const merged = withGroundPatches(
      voxels,
      [
        [O + 13, O, O - 5], // (3, 3) at kz 0: a hole, added
        [O + 10, O - 3, O - 5], // (0, 0) at kz 0: applied already, not added twice
        [O + 100, O, O - 5], // another tree's
      ],
    );
    expect(merged.count).toBe(voxels.count + 1);
    expect([...merged.keys.subarray(voxels.count * 3)]).toEqual([3, 3, 0]);
    expect(merged.keyMin).toEqual(voxels.keyMin);
    // The tree's own keys are left as they were.
    expect(voxels.count).toBe(site().count);
  });

  it("hands back the tree itself when no patch adds a cell", () => {
    const voxels = site();
    expect(withGroundPatches(voxels, [])).toBe(voxels);
    expect(withGroundPatches(voxels, [[O + 10, O - 3, O - 5]])).toBe(voxels);
  });

  it("compares edit sets by their patches", () => {
    expect(sameEdits(new Map([[1, 0]]), new Map([[1, 0]]))).toBe(true);
    expect(sameEdits(new Map([[1, 0]]), new Map([[1, 1]]))).toBe(false);
    expect(sameEdits(new Map([[1, 0]]), new Map())).toBe(false);
  });
});

describe("the session", () => {
  it("rebuilds the floors when the band moves", () => {
    const session = createGroundSession(site(), new Map());
    expect(session.floors.floor[index(6, 6)]).toBe(0);
    setGroundBand(session, { lo: 20, hi: 30 });
    expect(session.floors.floor[index(6, 6)]).toBe(30);
    expect(session.band).toEqual({ lo: 20, hi: 30 });
  });
});
