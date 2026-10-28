import { describe, expect, it } from "vitest";

import {
  UNDO_BUDGET_BYTES,
  UNDO_MAX_ENTRIES,
  createUndoStack,
  popRedo,
  popUndo,
  pushPatch,
} from "@/lib/map/undo";

/**
 * The editors' history: an entry moves between the two stacks, and the byte
 * total is kept incrementally. A drift shows only as a leak or an edit that
 * can no longer be undone.
 */
interface Edit {
  bytes: number;
}

const weigh = (edit: Edit) => edit.bytes;
const edit = (bytes = 6): Edit => ({ bytes });

describe("the undo stack", () => {
  it("is empty until something is pushed", () => {
    const stack = createUndoStack(weigh);
    expect(popUndo(stack)).toBeNull();
    expect(popRedo(stack)).toBeNull();
  });

  it("moves an entry between the two stacks", () => {
    const stack = createUndoStack(weigh);
    const e = edit();
    pushPatch(stack, e);

    expect(popUndo(stack)).toBe(e);
    expect(stack.undo).toHaveLength(0);
    expect(stack.redo).toHaveLength(1);

    expect(popRedo(stack)).toBe(e);
    expect(stack.undo).toHaveLength(1);
    expect(stack.redo).toHaveLength(0);
  });

  it("discards the redone future when a new edit arrives", () => {
    // The byte total must drop with the redo stack, or memory leaks.
    const stack = createUndoStack(weigh);
    pushPatch(stack, edit(10));
    popUndo(stack);
    expect(stack.redo).toHaveLength(1);

    pushPatch(stack, edit(6));
    expect(stack.redo).toHaveLength(0);
    expect(stack.bytes).toBe(6);
  });

  it("keeps `bytes` equal to what the stacks actually hold", () => {
    const stack = createUndoStack(weigh);
    for (const bytes of [3, 5, 7]) pushPatch(stack, edit(bytes));
    popUndo(stack);
    popUndo(stack);

    const held = [...stack.undo, ...stack.redo].reduce((total, e) => total + e.bytes, 0);
    expect(stack.bytes).toBe(held);
  });

  it("evicts the oldest edit past the entry ceiling", () => {
    const stack = createUndoStack(weigh);
    for (let i = 0; i < UNDO_MAX_ENTRIES + 10; i += 1) pushPatch(stack, edit());
    expect(stack.undo).toHaveLength(UNDO_MAX_ENTRIES);
    expect(stack.bytes).toBe(UNDO_MAX_ENTRIES * 6);
  });

  it("evicts the oldest edit past the byte budget", () => {
    const stack = createUndoStack(weigh);
    const first = edit(UNDO_BUDGET_BYTES / 2);
    pushPatch(stack, first);
    pushPatch(stack, edit(UNDO_BUDGET_BYTES / 2));
    pushPatch(stack, edit(1));
    expect(stack.undo).not.toContain(first);
    expect(stack.bytes).toBeLessThanOrEqual(UNDO_BUDGET_BYTES);
  });

  it("never evicts the only entry, however large", () => {
    // Dropping it would leave it un-undoable, worse than over budget.
    const stack = createUndoStack(weigh);
    const huge = edit(UNDO_BUDGET_BYTES * 2);
    pushPatch(stack, huge);
    expect(stack.undo).toHaveLength(1);
    expect(popUndo(stack)).toBe(huge);
  });
});
