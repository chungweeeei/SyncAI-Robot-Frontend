// Undo/redo for the editors (the map's 3D editor, the task editor). Pure: no
// React, no DOM. Generic over the entry, which only its editor knows how to
// apply; `size` weighs an entry for the byte budget.

export interface UndoStack<T> {
  undo: T[];
  redo: T[];
  /** Running total of both stacks, maintained incrementally. */
  bytes: number;
  size: (entry: T) => number;
}

/**
 * Capped by bytes, with an entry ceiling so many tiny edits cannot grow the
 * array without limit.
 */
export const UNDO_BUDGET_BYTES = 32 * 1024 * 1024;
export const UNDO_MAX_ENTRIES = 100;

export function createUndoStack<T>(size: (entry: T) => number): UndoStack<T> {
  return { undo: [], redo: [], bytes: 0, size };
}

/** Push a new edit. Clears the redo stack — a new edit discards the redone future. */
export function pushPatch<T>(stack: UndoStack<T>, entry: T): void {
  stack.bytes += stack.size(entry);
  for (const dropped of stack.redo) stack.bytes -= stack.size(dropped);
  stack.redo = [];
  stack.undo.push(entry);

  while (
    stack.undo.length > UNDO_MAX_ENTRIES ||
    (stack.bytes > UNDO_BUDGET_BYTES && stack.undo.length > 1)
  ) {
    const evicted = stack.undo.shift();
    if (evicted === undefined) break;
    stack.bytes -= stack.size(evicted);
  }
}

export function popUndo<T>(stack: UndoStack<T>): T | null {
  const entry = stack.undo.pop();
  if (entry === undefined) return null;
  stack.redo.push(entry);
  return entry;
}

export function popRedo<T>(stack: UndoStack<T>): T | null {
  const entry = stack.redo.pop();
  if (entry === undefined) return null;
  stack.undo.push(entry);
  return entry;
}
