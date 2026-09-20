import { describe, expect, it } from "vitest";

import { FREE, OCCUPIED, UNKNOWN, countValues, type MapGrid } from "@/lib/map/grid";
import {
  UNDO_MAX_ENTRIES,
  applyCountsDelta,
  applyPatch,
  createUndoStack,
  patchBytes,
  popRedo,
  popUndo,
  pushPatch,
  type GridPatch,
} from "@/lib/map/patch";

/**
 * The editor's history. Two properties carry the whole feature: undo and redo
 * are the same write with a different side, and the cell census is maintained
 * incrementally rather than by re-counting 2.4 M cells after every dab. A drift
 * in either is only visible as a wrong number or an un-undoable stroke.
 */
function grid(bytes: number[]): MapGrid {
  return { width: bytes.length, height: 1, data: new Uint8Array(bytes) };
}

function patch(
  cells: number[],
  before: number[],
  after: number[],
): GridPatch {
  return {
    cells: new Uint32Array(cells),
    before: new Uint8Array(before),
    after: new Uint8Array(after),
    bounds: { col: 0, row: 0, w: cells.length, h: 1 },
  };
}

describe("applyPatch", () => {
  it("writes the after side and the before side back again", () => {
    const g = grid([UNKNOWN, UNKNOWN, UNKNOWN]);
    const p = patch([0, 2], [UNKNOWN, UNKNOWN], [FREE, OCCUPIED]);

    applyPatch(g, p, "after");
    expect([...g.data]).toEqual([FREE, UNKNOWN, OCCUPIED]);

    applyPatch(g, p, "before");
    expect([...g.data]).toEqual([UNKNOWN, UNKNOWN, UNKNOWN]);
  });

  it("round-trips any number of times, because nothing is recomputed", () => {
    const g = grid([UNKNOWN, UNKNOWN]);
    const p = patch([0, 1], [UNKNOWN, UNKNOWN], [FREE, FREE]);
    for (let i = 0; i < 5; i += 1) {
      applyPatch(g, p, "after");
      applyPatch(g, p, "before");
    }
    expect([...g.data]).toEqual([UNKNOWN, UNKNOWN]);
  });

  it("touches only the cells it lists", () => {
    const g = grid([UNKNOWN, OCCUPIED, UNKNOWN]);
    applyPatch(g, patch([0], [UNKNOWN], [FREE]), "after");
    expect([...g.data]).toEqual([FREE, OCCUPIED, UNKNOWN]);
  });
});

describe("applyCountsDelta", () => {
  it("tracks what a full re-count would say", () => {
    const g = grid([UNKNOWN, UNKNOWN, UNKNOWN, OCCUPIED]);
    const p = patch([0, 1], [UNKNOWN, UNKNOWN], [FREE, OCCUPIED]);

    let counts = countValues(g);
    applyPatch(g, p, "after");
    counts = applyCountsDelta(counts, p, "after");
    expect(counts).toEqual(countValues(g));

    applyPatch(g, p, "before");
    counts = applyCountsDelta(counts, p, "before");
    expect(counts).toEqual(countValues(g));
  });

  it("nets to zero when a cell is repainted its own value", () => {
    const counts = { occupied: 1, unknown: 2, free: 3 };
    const noop = patch([0], [FREE], [FREE]);
    expect(applyCountsDelta(counts, noop, "after")).toEqual(counts);
  });

  it("classifies by byte range, not by exact value", () => {
    // A stroke reads `before` off the buffer, which holds whatever the .pgm
    // had — 128 is UNKNOWN even though it is not the canonical 205.
    const counts = { occupied: 0, unknown: 1, free: 0 };
    const p = patch([0], [128], [FREE]);
    expect(applyCountsDelta(counts, p, "after")).toEqual({
      occupied: 0,
      unknown: 0,
      free: 1,
    });
  });
});

describe("the undo stack", () => {
  const dab = () => patch([0], [UNKNOWN], [FREE]);

  it("is empty until something is pushed", () => {
    const stack = createUndoStack();
    expect(popUndo(stack)).toBeNull();
    expect(popRedo(stack)).toBeNull();
  });

  it("moves a patch between the two stacks", () => {
    const stack = createUndoStack();
    const p = dab();
    pushPatch(stack, p);

    expect(popUndo(stack)).toBe(p);
    expect(stack.undo).toHaveLength(0);
    expect(stack.redo).toHaveLength(1);

    expect(popRedo(stack)).toBe(p);
    expect(stack.undo).toHaveLength(1);
    expect(stack.redo).toHaveLength(0);
  });

  it("discards the redone future when a new edit arrives", () => {
    // The rule every editor has, and the one that leaks memory if the byte
    // total is not adjusted with it.
    const stack = createUndoStack();
    pushPatch(stack, dab());
    popUndo(stack);
    expect(stack.redo).toHaveLength(1);

    pushPatch(stack, dab());
    expect(stack.redo).toHaveLength(0);
    expect(stack.bytes).toBe(patchBytes(dab()));
  });

  it("keeps `bytes` equal to what the stacks actually hold", () => {
    const stack = createUndoStack();
    const patches = [dab(), dab(), dab()];
    for (const p of patches) pushPatch(stack, p);
    popUndo(stack);
    popUndo(stack);

    const held = [...stack.undo, ...stack.redo].reduce(
      (total, p) => total + patchBytes(p),
      0,
    );
    expect(stack.bytes).toBe(held);
  });

  it("evicts the oldest edit past the entry ceiling", () => {
    const stack = createUndoStack();
    for (let i = 0; i < UNDO_MAX_ENTRIES + 10; i += 1) pushPatch(stack, dab());
    expect(stack.undo).toHaveLength(UNDO_MAX_ENTRIES);
    expect(stack.bytes).toBe(UNDO_MAX_ENTRIES * patchBytes(dab()));
  });

  it("never evicts the only entry, however large", () => {
    // A full-map fill is ~14 MB; dropping it would leave a stroke that cannot
    // be undone at all, which is worse than being over budget.
    const stack = createUndoStack();
    const huge = patch(
      Array.from({ length: 6_000_000 }, (_, i) => i),
      new Array(6_000_000).fill(UNKNOWN),
      new Array(6_000_000).fill(FREE),
    );
    pushPatch(stack, huge);
    expect(stack.undo).toHaveLength(1);
    expect(popUndo(stack)).toBe(huge);
  });
});
