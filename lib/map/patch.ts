// Undo/redo for grid edits. Pure: no React, no DOM.
//
// A patch is a **sparse cell list** (6 bytes per changed cell), not a dirty
// rectangle: a diagonal brush drag changes ~5 000 cells inside a ~1000x1000 box,
// so a rect would spend 2 MB on it. Sparse loses ~3x on a dense fill and wins
// ~66x on the common stroke. Full-buffer snapshots (2.4 MB each) would make a
// useful history hundreds of MB on a Jetson.

import {
  OCCUPIED,
  UNKNOWN,
  classify,
  type CellRect,
  type CellSink,
  type GridValue,
  type MapGrid,
  type ValueCounts,
} from "@/lib/map/grid";

/** One undoable edit: every cell one stroke changed, with both sides recorded. */
export interface GridPatch {
  /** Row-major indices (row * width + col), in stamp order. */
  cells: Uint32Array;
  /** Parallel to `cells`: the byte before the stroke. */
  before: Uint8Array;
  /** Parallel to `cells`: the byte after it. */
  after: Uint8Array;
  /**
   * Union bounding box of `cells` — repaint metadata only. It says which region
   * of the mirror canvas to re-blit; it never defines the patch's extent.
   */
  bounds: CellRect;
}

export function patchBytes(patch: GridPatch): number {
  return patch.cells.length * 6;
}

/**
 * Write one side of a patch back into the grid. Undo and redo differ only in
 * the side, which is why `after` is stored: no replay, no base state.
 */
export function applyPatch(
  grid: MapGrid,
  patch: GridPatch,
  side: "before" | "after",
): void {
  const values = side === "before" ? patch.before : patch.after;
  const { cells } = patch;
  const { data } = grid;
  for (let i = 0; i < cells.length; i += 1) {
    data[cells[i]] = values[i];
  }
}

const INITIAL_CAPACITY = 4096;

/** Collects one stroke as it is drawn, through the `sink` the stamp primitives write to. */
export class StrokeAccumulator {
  private readonly grid: MapGrid;
  /**
   * One byte per cell, allocated once and cleared over the stroke's bounds at
   * commit. A Map would cost >100 MB for a whole-map stroke.
   */
  private readonly touched: Uint8Array;

  private cells: Uint32Array = new Uint32Array(INITIAL_CAPACITY);
  private before: Uint8Array = new Uint8Array(INITIAL_CAPACITY);
  private after: Uint8Array = new Uint8Array(INITIAL_CAPACITY);
  private count = 0;

  // `bounds` spans the whole stroke (the patch's repaint metadata); `frame` resets
  // after every blit. Blitting `bounds` each frame would be quadratic in length.
  private bounds: MutableRect | null = null;
  private frame: MutableRect | null = null;

  constructor(grid: MapGrid, touched: Uint8Array) {
    this.grid = grid;
    this.touched = touched;
  }

  readonly sink: CellSink = (index: number, value: GridValue) => {
    const { data } = this.grid;
    const current = data[index];
    // Not an edit, or a no-op patch would make the next Ctrl+Z appear to do nothing.
    if (current === value) return;

    if (!this.touched[index]) {
      this.touched[index] = 1;
      if (this.count === this.cells.length) this.grow();
      this.cells[this.count] = index;
      this.before[this.count] = current;
      this.after[this.count] = value;
      this.count += 1;
    } else {
      // A repeat pass: keep the first `before` (the true pre-stroke byte), update `after`.
      this.after[this.indexOf(index)] = value;
    }

    data[index] = value;

    const col = index % this.grid.width;
    const row = (index - col) / this.grid.width;
    this.bounds = grow(this.bounds, col, row);
    this.frame = grow(this.frame, col, row);
  };

  get isEmpty(): boolean {
    return this.count === 0;
  }

  /** Cells changed since the last call — the region to blit into the mirror. */
  takeFrameDirty(): CellRect | null {
    const rect = this.frame;
    this.frame = null;
    return rect ? toRect(rect) : null;
  }

  /** Freeze the stroke. Returns null when it changed nothing. */
  commit(): GridPatch | null {
    if (!this.bounds || this.count === 0) {
      this.reset();
      return null;
    }

    const bounds = toRect(this.bounds);
    const patch: GridPatch = {
      cells: this.cells.slice(0, this.count),
      before: this.before.slice(0, this.count),
      after: this.after.slice(0, this.count),
      bounds,
    };
    this.reset();
    return patch;
  }

  /** Clear `touched` over the stroke's rows only, so a stroke costs what it drew. */
  private reset(): void {
    if (this.bounds) {
      const { col, row, w, h } = toRect(this.bounds);
      for (let r = row; r < row + h; r += 1) {
        const base = r * this.grid.width;
        this.touched.fill(0, base + col, base + col + w);
      }
    }
    this.count = 0;
    this.bounds = null;
    this.frame = null;
  }

  /**
   * Linear scan of the stroke's log. Only reached when a stroke repaints a cell
   * with a *different* value, rare enough that an index map (9.6 MB) is not worth it.
   */
  private indexOf(index: number): number {
    for (let i = this.count - 1; i >= 0; i -= 1) {
      if (this.cells[i] === index) return i;
    }
    return this.count - 1;
  }

  private grow(): void {
    const size = this.cells.length * 2;
    const cells = new Uint32Array(size);
    const before = new Uint8Array(size);
    const after = new Uint8Array(size);
    cells.set(this.cells);
    before.set(this.before);
    after.set(this.after);
    this.cells = cells;
    this.before = before;
    this.after = after;
  }
}

interface MutableRect {
  minCol: number;
  minRow: number;
  maxCol: number;
  maxRow: number;
}

function grow(rect: MutableRect | null, col: number, row: number): MutableRect {
  if (!rect) return { minCol: col, minRow: row, maxCol: col, maxRow: row };
  if (col < rect.minCol) rect.minCol = col;
  if (col > rect.maxCol) rect.maxCol = col;
  if (row < rect.minRow) rect.minRow = row;
  if (row > rect.maxRow) rect.maxRow = row;
  return rect;
}

function toRect(rect: MutableRect): CellRect {
  return {
    col: rect.minCol,
    row: rect.minRow,
    w: rect.maxCol - rect.minCol + 1,
    h: rect.maxRow - rect.minRow + 1,
  };
}

/** Move a cell census across a patch, rather than recount up to 2.4 M cells per dab. */
export function applyCountsDelta(
  counts: ValueCounts,
  patch: GridPatch,
  side: "before" | "after",
): ValueCounts {
  const from = side === "before" ? patch.after : patch.before;
  const to = side === "before" ? patch.before : patch.after;
  const next = { ...counts };

  for (let i = 0; i < from.length; i += 1) {
    bump(next, classify(from[i]), -1);
    bump(next, classify(to[i]), 1);
  }
  return next;
}

function bump(counts: ValueCounts, value: GridValue, by: number): void {
  if (value === OCCUPIED) counts.occupied += by;
  else if (value === UNKNOWN) counts.unknown += by;
  else counts.free += by;
}

/**
 * The editor's history, generic because waypoint edits share it with strokes
 * (lib/map/history.ts). `size` weighs an entry for the byte budget.
 */
export interface UndoStack<T = GridPatch> {
  undo: T[];
  redo: T[];
  /** Running total of both stacks, maintained incrementally. */
  bytes: number;
  size: (entry: T) => number;
}

/**
 * Capped by bytes (a dab is ~1 KB, a full-map fill ~14 MB), with an entry
 * ceiling so many tiny dabs cannot grow the array without limit.
 */
export const UNDO_BUDGET_BYTES = 32 * 1024 * 1024;
export const UNDO_MAX_ENTRIES = 100;

export function createUndoStack(): UndoStack<GridPatch>;
export function createUndoStack<T>(size: (entry: T) => number): UndoStack<T>;
export function createUndoStack<T>(
  size: (entry: T) => number = patchBytes as unknown as (entry: T) => number,
): UndoStack<T> {
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
