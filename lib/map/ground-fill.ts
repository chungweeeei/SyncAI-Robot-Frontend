// The ground editor's rules: which columns of the 3D map a brush may fill,
// at what height, and the record of what it filled. Pure, so the component
// only acts on them (lib/map/grid.ts's stamps do the disc).
//
// The lidar sees the floor only at grazing angles, and the robot's own fill
// closes only enclosed gaps, so a floor no ray looked into stays unknown and
// the planner refuses it. An operator who knows it is floor paints it here;
// the backend records the result (octomap_edits.json) and the robot's tool
// writes it into the tree. These rules are the standalone viewer's, moved.

import { type GridSize, stampDisc } from "@/lib/map/grid";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";
import type { MapMetadata } from "@/lib/types/robot";

/**
 * How many existing floor cells the median needs before a column may be
 * filled: fewer and the height would be one cell's guess.
 */
export const MIN_FLOOR_SAMPLES = 5;

/**
 * The band above a filled floor that must hold no voxel: the planner's
 * body_clearance, which the robot's tool marks free. A voxel in it means
 * the column is not a hole — a ramp a little off the median, a wall foot,
 * an obstacle — and a floor slipped under it would only mislead the planner.
 */
export const CLEARANCE_M = 0.6;

/** How far beyond the brush the median reads the existing floor from. */
export const LOCAL_FLOOR_RING_M = 1.0;

/** The brush radii offered, metres; one cell at the robot's resolution first. */
export const BRUSH_RADII_M = [0.1, 0.2, 0.3, 0.5, 1.0] as const;
export const DEFAULT_BRUSH_RADIUS_M = 0.3;

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

/** Metres to a relative kz and back, for the band controls. */
export function metresToKz(metres: number, voxels: OccupiedVoxels): number {
  return Math.floor(metres / voxels.res) + OCTREE_KEY_ORIGIN - voxels.keyMin[2];
}

export function kzToMetres(kz: number, voxels: OccupiedVoxels): number {
  return (kz + voxels.keyMin[2] - OCTREE_KEY_ORIGIN + 0.5) * voxels.res;
}

/** Cells for a metric length at the tree's resolution, rounded. */
export function cellsFor(metres: number, res: number): number {
  return Math.max(0, Math.round(metres / res));
}

/** The clearance band in cells, rounded up so a 0.1 m tree gets six. */
export function clearanceCells(res: number): number {
  return Math.max(1, Math.ceil(CLEARANCE_M / res - 1e-9));
}

/** The operator's patches: column index -> relative kz of the filled cell. */
export type GroundEdits = Map<number, number>;

/**
 * The floor height a filled column gets: the median of the existing floor
 * (and earlier patches) within `radius` cells of the dab, or null with
 * fewer than MIN_FLOOR_SAMPLES to read. A median, so a stray low voxel in
 * the ring does not sink the patch.
 */
export function localFloor(
  floors: ColumnFloors,
  edits: GroundEdits,
  col: number,
  row: number,
  radius: number,
): number | null {
  const samples: number[] = [];
  stampDisc(floors, col, row, 2 * radius + 1, 0, (index) => {
    const f = floors.floor[index];
    if (f !== NO_FLOOR) samples.push(f);
    else {
      const patched = edits.get(index);
      if (patched !== undefined) samples.push(patched);
    }
  });
  if (samples.length < MIN_FLOOR_SAMPLES) return null;
  samples.sort((a, b) => a - b);
  return samples[samples.length >> 1];
}

/**
 * Whether a column is a hole a floor at `f` may go into: nothing occupied
 * from the floor up through the clearance band. A voxel there is floor
 * already, or something standing on it.
 */
export function isHole(floors: ColumnFloors, index: number, f: number, clearance: number): boolean {
  const existing = floors.floor[index];
  return existing === NO_FLOOR || existing > f + clearance;
}

/**
 * One stroke's changes, sparse: the column and the patch before and after
 * (NO_FLOOR for none). What the undo stack holds.
 */
export interface GroundPatch {
  cells: Uint32Array;
  before: Int16Array;
  after: Int16Array;
}

export function groundPatchBytes(patch: GroundPatch): number {
  return patch.cells.length * 8;
}

/**
 * Collects a stroke's dabs into one patch, keeping the first `before` of a
 * column touched twice, and hands back which columns each dab changed so
 * the canvas repaints only those.
 */
export class GroundStroke {
  private readonly touched = new Map<number, number>();

  /** Record a column's change; `before` is kept from the first touch. */
  record(index: number, before: number): void {
    if (!this.touched.has(index)) this.touched.set(index, before);
  }

  get size(): number {
    return this.touched.size;
  }

  /** The stroke as a patch against `edits` now, or null if it changed nothing. */
  commit(edits: GroundEdits): GroundPatch | null {
    const entries = [...this.touched].filter(([index, before]) => {
      const after = edits.get(index) ?? NO_FLOOR;
      return after !== before;
    });
    this.touched.clear();
    if (entries.length === 0) return null;
    return {
      cells: Uint32Array.from(entries, ([index]) => index),
      before: Int16Array.from(entries, ([, before]) => before),
      after: Int16Array.from(entries, ([index]) => edits.get(index) ?? NO_FLOOR),
    };
  }
}

/**
 * Fill the holes under a brush disc at the height of the floor around it.
 * Returns the columns that changed (for the repaint), empty when the dab
 * found no floor to read or no hole to fill. `ring` is how far past the
 * brush the median reads.
 */
export function fillDab(
  floors: ColumnFloors,
  edits: GroundEdits,
  stroke: GroundStroke,
  col: number,
  row: number,
  radius: number,
  ring: number,
  clearance: number,
): number[] {
  const f = localFloor(floors, edits, col, row, radius + ring);
  if (f === null) return [];
  const changed: number[] = [];
  stampDisc(floors, col, row, 2 * radius + 1, 0, (index) => {
    if (edits.has(index)) return;
    if (!isHole(floors, index, f, clearance)) return;
    stroke.record(index, NO_FLOOR);
    edits.set(index, f);
    changed.push(index);
  });
  return changed;
}

/** Take the operator's own patches back out from under the disc. */
export function eraseDab(
  floors: ColumnFloors,
  edits: GroundEdits,
  stroke: GroundStroke,
  col: number,
  row: number,
  radius: number,
): number[] {
  const changed: number[] = [];
  stampDisc(floors, col, row, 2 * radius + 1, 0, (index) => {
    const before = edits.get(index);
    if (before === undefined) return;
    stroke.record(index, before);
    edits.delete(index);
    changed.push(index);
  });
  return changed;
}

/** Put a patch's `before` or `after` side back into the edits. */
export function applyGroundPatch(
  edits: GroundEdits,
  patch: GroundPatch,
  side: "before" | "after",
): void {
  const values = side === "before" ? patch.before : patch.after;
  for (let i = 0; i < patch.cells.length; i += 1) {
    const index = patch.cells[i];
    if (values[i] === NO_FLOOR) edits.delete(index);
    else edits.set(index, values[i]);
  }
}

/** The patches as the backend records them: absolute keys, one per column. */
export function toFillKeys(edits: GroundEdits, voxels: OccupiedVoxels): number[][] {
  const [width] = voxels.size;
  const [x0, y0, z0] = voxels.keyMin;
  return [...edits].map(([index, kz]) => [
    (index % width) + x0,
    Math.floor(index / width) + y0,
    kz + z0,
  ]);
}

/**
 * The backend's record as edits, dropping keys outside the tree's box (a
 * record from another save) and counting them.
 */
export function fromFillKeys(
  keys: readonly (readonly number[])[],
  voxels: OccupiedVoxels,
): { edits: GroundEdits; skipped: number } {
  const [width, height, depth] = voxels.size;
  const [x0, y0, z0] = voxels.keyMin;
  const edits: GroundEdits = new Map();
  let skipped = 0;
  for (const key of keys) {
    const x = key[0] - x0;
    const y = key[1] - y0;
    const z = key[2] - z0;
    if (x < 0 || x >= width || y < 0 || y >= height || z < 0 || z >= depth) {
      skipped += 1;
      continue;
    }
    edits.set(x + y * width, z);
  }
  return { edits, skipped };
}

/** Whether two edit sets hold the same patches, for the dirty flag. */
export function sameEdits(a: GroundEdits, b: GroundEdits): boolean {
  if (a.size !== b.size) return false;
  for (const [index, kz] of a) if (b.get(index) !== kz) return false;
  return true;
}

/**
 * The raster the editor draws and hit-tests as a floor plan: one cell per
 * column, origin at the tree's box, so lib/map/view.ts's transforms and the
 * cell readout apply unchanged. Raster row 0 is the top (the highest ky),
 * as worldToGrid expects.
 */
export function groundMeta(voxels: OccupiedVoxels): MapMetadata {
  const [width, height] = voxels.size;
  return {
    resolution: voxels.res,
    origin: [
      (voxels.keyMin[0] - OCTREE_KEY_ORIGIN) * voxels.res,
      (voxels.keyMin[1] - OCTREE_KEY_ORIGIN) * voxels.res,
      0,
    ],
    width,
    height,
  };
}

/** A raster cell (col right, row down) to its column index (ky up). */
export function columnOf(size: GridSize, col: number, row: number): number {
  return col + (size.height - 1 - row) * size.width;
}

/** The column's raster cell, the inverse of `columnOf`. */
export function cellOf(size: GridSize, index: number): { col: number; row: number } {
  const col = index % size.width;
  return { col, row: size.height - 1 - Math.floor(index / size.width) };
}

/**
 * The editor's mutable state, held by reference like the floor plan's
 * GridSession and never put in React state: a stroke writes `edits` at
 * pointer rate. `floors` follows `band`; `setGroundBand` rebuilds it.
 */
export interface GroundSession {
  voxels: OccupiedVoxels;
  meta: MapMetadata;
  size: GridSize;
  band: Band;
  floors: ColumnFloors;
  edits: GroundEdits;
}

export function createGroundSession(
  voxels: OccupiedVoxels,
  edits: GroundEdits,
  band: Band = fullBand(voxels),
): GroundSession {
  const [width, height] = voxels.size;
  return {
    voxels,
    meta: groundMeta(voxels),
    size: { width, height },
    band,
    floors: columnFloors(voxels, band),
    edits,
  };
}

export function setGroundBand(session: GroundSession, band: Band): void {
  session.band = band;
  session.floors = columnFloors(session.voxels, band);
}
