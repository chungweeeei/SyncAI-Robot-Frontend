// Where the 3D map shows the ground: each column's floor inside a height
// band, the height a floor mostly stands on, and the ground under a point.
// Read by the editor's 3D view and the dashboard to stand a placed waypoint on
// the floor it was placed on, and to frame a view on it.

import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

/** The xy extent of the 3D map's columns, in cells. */
export interface GridSize {
  width: number;
  height: number;
}

/** `ColumnFloors.floor` for a column with no voxel in the band. */
export const NO_FLOOR = -1;

/** A height band in relative kz, inclusive. */
export interface Band {
  lo: number;
  hi: number;
}

/**
 * Each xy column's floor: the lowest occupied cell inside the height band,
 * as a relative kz, or NO_FLOOR. Indexed `kx + ky * width` — ky up, as the
 * tree keys run, not as a raster row.
 */
export interface ColumnFloors extends GridSize {
  floor: Int16Array;
}

export function columnFloors(voxels: OccupiedVoxels, band: Band): ColumnFloors {
  const [width, height] = voxels.size;
  const floor = new Int16Array(width * height).fill(NO_FLOOR);
  const { keys, count } = voxels;
  for (let i = 0; i < count * 3; i += 3) {
    const kz = keys[i + 2];
    if (kz < band.lo || kz > band.hi) continue;
    const c = keys[i] + keys[i + 1] * width;
    if (floor[c] === NO_FLOOR || kz < floor[c]) floor[c] = kz;
  }
  return { width, height, floor };
}

/**
 * Every column's occupied cells, whatever the band: column `c`'s relative
 * kz are `kz[start[c] .. start[c + 1])`, ascending. What a surface is read
 * off where one column holds several — a flight of stairs over the ground,
 * one flight over another — which `ColumnFloors`, one cell a column, cannot
 * tell apart. Indexed as `ColumnFloors` is.
 */
export interface ColumnStacks extends GridSize {
  start: Uint32Array;
  kz: Int16Array;
}

export function columnStacks(voxels: OccupiedVoxels): ColumnStacks {
  const [width, height] = voxels.size;
  const columns = width * height;
  const { keys, count } = voxels;
  // A counting sort by column: two passes over the keys, no per-column arrays.
  const start = new Uint32Array(columns + 1);
  for (let i = 0; i < count * 3; i += 3) start[keys[i] + keys[i + 1] * width + 1] += 1;
  for (let c = 0; c < columns; c += 1) start[c + 1] += start[c];
  const at = start.slice(0, columns);
  const kz = new Int16Array(count);
  for (let i = 0; i < count * 3; i += 3) {
    const c = keys[i] + keys[i + 1] * width;
    kz[at[c]] = keys[i + 2];
    at[c] += 1;
  }
  for (let c = 0; c < columns; c += 1) kz.subarray(start[c], start[c + 1]).sort();
  return { width, height, start, kz };
}

/** Whether a column holds an occupied cell in `[lo, hi]`, relative kz. */
export function occupiedIn(stacks: ColumnStacks, column: number, lo: number, hi: number): boolean {
  let a = stacks.start[column];
  let b = stacks.start[column + 1];
  // The first cell at or over `lo`, by bisection: a column can be a wall's
  // whole height.
  while (a < b) {
    const mid = (a + b) >> 1;
    if (stacks.kz[mid] < lo) a = mid + 1;
    else b = mid;
  }
  return a < stacks.start[column + 1] && stacks.kz[a] <= hi;
}

/**
 * The surface of a column nearest the height `z` within `[lo, hi]`, relative
 * kz, or NO_FLOOR: an occupied cell with the cell over it empty, the top of
 * a run, which is where a foot lands. A wall's cells have a cell over them,
 * so a wall is not read as floor at whatever height a window cuts it.
 */
export function surfaceNear(
  stacks: ColumnStacks,
  column: number,
  z: number,
  lo: number,
  hi: number,
): number {
  let best = NO_FLOOR;
  const end = stacks.start[column + 1];
  for (let i = stacks.start[column]; i < end; i += 1) {
    const kz = stacks.kz[i];
    if (kz < lo) continue;
    if (kz > hi) break;
    if (i + 1 < end && stacks.kz[i + 1] === kz + 1) continue;
    if (best === NO_FLOOR || Math.abs(kz - z) < Math.abs(best - z)) best = kz;
  }
  return best;
}

/** The whole tree's height range, relative kz. */
export function fullBand(voxels: OccupiedVoxels): Band {
  return { lo: 0, hi: Math.max(voxels.size[2] - 1, 0) };
}

/**
 * The band a floor's heights cover, `[loM, hiM)` metres by cell centre (the
 * rule the dashboard's layer draws a floor by), clamped to the tree; an
 * infinite end is the tree's own. Null when no level of the tree is in it.
 */
export function bandForHeights(voxels: OccupiedVoxels, loM: number, hiM: number): Band | null {
  const full = fullBand(voxels);
  const level = (metres: number) =>
    Math.ceil(metres / voxels.res - 0.5 + OCTREE_KEY_ORIGIN - voxels.keyMin[2]);
  const lo = Number.isFinite(loM) ? Math.max(full.lo, level(loM)) : full.lo;
  const hi = Number.isFinite(hiM) ? Math.min(full.hi, level(hiM) - 1) : full.hi;
  return lo <= hi ? { lo, hi } : null;
}

/** Metres to a relative kz and back, for the height sliders. */
export function metresToKz(metres: number, voxels: OccupiedVoxels): number {
  return Math.floor(metres / voxels.res) + OCTREE_KEY_ORIGIN - voxels.keyMin[2];
}

export function kzToMetres(kz: number, voxels: OccupiedVoxels): number {
  return (kz + voxels.keyMin[2] - OCTREE_KEY_ORIGIN + 0.5) * voxels.res;
}

/**
 * The floor the shown heights mostly stand on: the median of every column's
 * floor, relative kz, or null with no floor in the band. What the editor's
 * 3D view frames itself on, so the middle of the screen is the middle of the
 * map at the height the robot walks, not under it.
 */
export function medianFloor(floors: ColumnFloors): number | null {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < floors.floor.length; i += 1) {
    const f = floors.floor[i];
    if (f === NO_FLOOR) continue;
    counts.set(f, (counts.get(f) ?? 0) + 1);
    total += 1;
  }
  if (total === 0) return null;
  // A histogram, not a sort: a map is a few hundred levels and ~10^5 columns.
  const levels = [...counts.keys()].sort((x, y) => x - y);
  let seen = 0;
  for (const level of levels) {
    seen += counts.get(level)!;
    if (seen * 2 > total) return level;
  }
  return levels[levels.length - 1];
}

/**
 * Where the 3D map shows a floor's ground, metres: the median column floor
 * of the heights `[loM, hiM)`, at the cell's centre. Null when the tree has
 * no cell in them. Where an upstairs pick stands when `groundAt` has no
 * answer under it.
 */
export function floorHeightIn(voxels: OccupiedVoxels, loM: number, hiM: number): number | null {
  const band = bandForHeights(voxels, loM, hiM);
  const median = band && medianFloor(columnFloors(voxels, band));
  return median === null ? null : kzToMetres(median, voxels);
}

/**
 * Where the 3D map shows the ground under a map-frame point, metres: the
 * lowest cell of that column within the heights `[loM, hiM)`, at the cell's
 * centre, as `floorHeightIn` measures a whole floor. Null off the tree's box
 * or with no cell there (a hole, the void over a stairwell). The height a
 * pick on a floor stands at: a floor is rarely one height — a ramp, a step
 * between two halls — and the floor's median put every waypoint on it at
 * the same z, half a metre off the ground on robot01's `dp` 2F.
 */
export function groundAt(
  voxels: OccupiedVoxels,
  wx: number,
  wy: number,
  loM: number,
  hiM: number,
): number | null {
  const column = columnAt(voxels, wx, wy);
  const band = bandForHeights(voxels, loM, hiM);
  if (!column || !band) return null;
  // One column, so a pass over the keys rather than columnFloors' whole
  // grid: it runs once per pick, not per frame.
  let floor = NO_FLOOR;
  const { keys, count } = voxels;
  for (let i = 0; i < count * 3; i += 3) {
    if (keys[i] !== column.x || keys[i + 1] !== column.y) continue;
    const kz = keys[i + 2];
    if (kz < band.lo || kz > band.hi) continue;
    if (floor === NO_FLOOR || kz < floor) floor = kz;
  }
  return floor === NO_FLOOR ? null : kzToMetres(floor, voxels);
}

/**
 * The top face of the surface under a map-frame point whose top lies nearest
 * the height `z`, metres, searched `reach` either side of it; null off the
 * tree's box or with no surface in reach (a hole, a wall's column, the void
 * over a stairwell). The top face rather than the centre, because that is
 * where the robot's planner puts a route's ground and where a foot lands.
 * Nearest `z` rather than lowest: under a stair's flight a column holds the
 * ground and the treads, and the one the robot is on is the one at its own
 * height. Per draw rather than per pick, so it reads `stacks`, not the keys.
 */
export function surfaceTopNear(
  voxels: OccupiedVoxels,
  stacks: ColumnStacks,
  wx: number,
  wy: number,
  z: number,
  reach: number,
): number | null {
  const column = columnAt(voxels, wx, wy);
  if (!column) return null;
  // The relative kz whose top face is at `z` (fractional), and the band.
  const kz = z / voxels.res - 1 + OCTREE_KEY_ORIGIN - voxels.keyMin[2];
  const span = reach / voxels.res;
  const top = surfaceNear(
    stacks,
    column.x + column.y * stacks.width,
    kz,
    Math.floor(kz - span),
    Math.ceil(kz + span),
  );
  return top === NO_FLOOR ? null : kzToMetres(top, voxels) + voxels.res / 2;
}

/**
 * The column under a map-frame point (`x` right, `y` up, the tree's own key
 * order), or null off the tree's box: where a pick stops being on the map.
 */
export function columnAt(
  voxels: OccupiedVoxels,
  wx: number,
  wy: number,
): { x: number; y: number } | null {
  const x = Math.floor(wx / voxels.res) + OCTREE_KEY_ORIGIN - voxels.keyMin[0];
  const y = Math.floor(wy / voxels.res) + OCTREE_KEY_ORIGIN - voxels.keyMin[1];
  if (x < 0 || y < 0 || x >= voxels.size[0] || y >= voxels.size[1]) return null;
  return { x, y };
}
