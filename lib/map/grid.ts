// The occupancy grid as the .pgm on disk holds it, plus the stamp primitives the
// editor paints with. Pure: no React, no DOM, no canvas.

/** Cell extent of a grid. */
export interface GridSize {
  width: number;
  height: number;
}

/**
 * A gridmap in .pgm byte order: row 0 is the **top** of the map (max y), the
 * other way up from a ROS OccupancyGrid. worldToGrid/gridToWorld handle the flip.
 */
export interface MapGrid extends GridSize {
  /**
   * `<ArrayBuffer>`, not the default `ArrayBufferLike` (which admits
   * SharedArrayBuffer and so is not a `BodyInit`): this buffer is the
   * `PUT .../grid` body, uncopied.
   */
  data: Uint8Array<ArrayBuffer>;
}

export interface Cell {
  col: number;
  row: number;
}

export interface CellRect {
  col: number;
  row: number;
  w: number;
  h: number;
}

/**
 * The only three bytes this editor writes. Not thresholds: the map loader (with
 * every gridmap.yaml's thresholds) reads `g <= 89` as occupied, `90..205` as
 * unknown and `g >= 206` as free, so real maps also hold 255s. Read by range
 * (`classify`), write these, matching what the conversion tool produces.
 */
export const OCCUPIED = 0;
export const UNKNOWN = 205;
export const FREE = 254;

export type GridValue = typeof OCCUPIED | typeof UNKNOWN | typeof FREE;

/** What the loader will make of a byte. */
export function classify(byte: number): GridValue {
  if (byte <= 89) return OCCUPIED;
  if (byte <= 205) return UNKNOWN;
  return FREE;
}

/** Brush diameters in cells. Odd only: an even one has no centre cell. */
export const BRUSH_SIZES = [1, 3, 7, 15, 31] as const;

/**
 * Where a stamp's cells go: the undo accumulator records through it, and the
 * previews collect the exact cells they would commit without touching the buffer.
 */
export type CellSink = (index: number, value: GridValue) => void;

export function cellIndex(size: GridSize, col: number, row: number): number {
  return row * size.width + col;
}

export function inBounds(size: GridSize, col: number, row: number): boolean {
  return col >= 0 && col < size.width && row >= 0 && row < size.height;
}

/**
 * A filled disc of the given diameter centred on (col, row). The `r * r + r`
 * fudge is deliberate: plain `<= r²` draws diameter 3 as a plus sign.
 */
export function stampDisc(
  size: GridSize,
  col: number,
  row: number,
  diameter: number,
  value: GridValue,
  sink: CellSink,
): void {
  const r = (diameter - 1) / 2;
  const rr = r * r + r;

  const rowFrom = Math.max(-r, -row);
  const rowTo = Math.min(r, size.height - 1 - row);

  for (let dy = rowFrom; dy <= rowTo; dy += 1) {
    const span = r === 0 ? 0 : Math.floor(Math.sqrt(Math.max(rr - dy * dy, 0)));
    const colFrom = Math.max(-span, -col);
    const colTo = Math.min(span, size.width - 1 - col);
    const base = (row + dy) * size.width + col;
    for (let dx = colFrom; dx <= colTo; dx += 1) {
      sink(base + dx, value);
    }
  }
}

/**
 * A disc swept along the integer line from a to b. Also fills freehand drags
 * between pointer samples, which a fast flick spaces 100+ px apart, and keeps
 * the brush and the line tool from ever disagreeing.
 */
export function stampLine(
  size: GridSize,
  from: Cell,
  to: Cell,
  diameter: number,
  value: GridValue,
  sink: CellSink,
): void {
  let col = from.col;
  let row = from.row;
  const dCol = Math.abs(to.col - col);
  const dRow = Math.abs(to.row - row);
  const stepCol = col < to.col ? 1 : -1;
  const stepRow = row < to.row ? 1 : -1;
  let error = dCol - dRow;

  // Bresenham, stamping at every step; overlapping writes are absorbed by the sink.
  for (;;) {
    stampDisc(size, col, row, diameter, value, sink);
    if (col === to.col && row === to.row) return;
    const e2 = 2 * error;
    if (e2 > -dRow) {
      error -= dRow;
      col += stepCol;
    }
    if (e2 < dCol) {
      error += dCol;
      row += stepRow;
    }
  }
}

/** Filled axis-aligned rectangle, clipped to the grid. Corners in either order. */
export function stampRect(
  size: GridSize,
  from: Cell,
  to: Cell,
  value: GridValue,
  sink: CellSink,
): void {
  const colFrom = Math.max(Math.min(from.col, to.col), 0);
  const colTo = Math.min(Math.max(from.col, to.col), size.width - 1);
  const rowFrom = Math.max(Math.min(from.row, to.row), 0);
  const rowTo = Math.min(Math.max(from.row, to.row), size.height - 1);

  for (let row = rowFrom; row <= rowTo; row += 1) {
    const base = row * size.width;
    for (let col = colFrom; col <= colTo; col += 1) {
      sink(base + col, value);
    }
  }
}

export interface ValueCounts {
  occupied: number;
  unknown: number;
  free: number;
}

/** Cell census, for the status bar. One pass; called on load and after a stroke. */
export function countValues(grid: MapGrid): ValueCounts {
  let occupied = 0;
  let unknown = 0;
  const { data } = grid;
  for (let i = 0; i < data.length; i += 1) {
    const byte = data[i];
    if (byte <= 89) occupied += 1;
    else if (byte <= 205) unknown += 1;
  }
  return { occupied, unknown, free: data.length - occupied - unknown };
}
