// The 3D view's brush rules: which columns of the 3D map a brush may fill,
// at what height, and the record of what it filled. Pure, so the component
// only acts on them (lib/map/grid.ts's stamps do the disc).
//
// The lidar sees the floor only at grazing angles, and the robot's own fill
// closes only enclosed gaps, so a floor no ray looked into stays unknown and
// the planner refuses it. An operator who knows it is floor paints it here;
// the backend records the result (octomap_edits.json) and the robot's tool
// writes it into the tree. Where the ground is (each column's floor, the
// floor a band mostly stands on, the column under a point) is
// lib/map/ground.ts, which waypoint placement reads too.

import { type GridSize, stampDisc } from "@/lib/map/grid";
import {
  type Band,
  type ColumnFloors,
  columnFloors,
  fullBand,
  NO_FLOOR,
} from "@/lib/map/ground";
import type { OccupiedVoxels } from "@/lib/types/octree";

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

/**
 * The tree as the robot will have it once its tool applies the record: the
 * occupied cells plus each saved patch, for the dashboard, which shows the
 * map the robot drives on rather than the one it was built as. A union, not
 * an append — the tool rebuilds from the raw tree, so after it has run the
 * patches are in the tree as well as in the record, and a cell drawn twice
 * would be twice in every height-ordered draw range. A key outside the box
 * is another tree's, dropped as `fromFillKeys` drops it. Hands back the same
 * object when nothing is added, so a map with no patches is not redrawn.
 */
export function withGroundPatches(
  voxels: OccupiedVoxels,
  keys: readonly (readonly number[])[],
): OccupiedVoxels {
  const { edits } = fromFillKeys(keys, voxels);
  if (edits.size === 0) return voxels;
  const [width] = voxels.size;
  // Only the patched columns can collide, so only their cells are looked at.
  for (let i = 0; i < voxels.count * 3; i += 3) {
    const column = voxels.keys[i] + voxels.keys[i + 1] * width;
    if (edits.get(column) === voxels.keys[i + 2]) edits.delete(column);
  }
  if (edits.size === 0) return voxels;
  const keysOut = new Uint16Array((voxels.count + edits.size) * 3);
  keysOut.set(voxels.keys.subarray(0, voxels.count * 3));
  let at = voxels.count * 3;
  for (const [column, kz] of edits) {
    keysOut[at] = column % width;
    keysOut[at + 1] = Math.floor(column / width);
    keysOut[at + 2] = kz;
    at += 3;
  }
  return { ...voxels, keys: keysOut, count: voxels.count + edits.size };
}

/** Whether two edit sets hold the same patches, for the dirty flag. */
export function sameEdits(a: GroundEdits, b: GroundEdits): boolean {
  if (a.size !== b.size) return false;
  for (const [index, kz] of a) if (b.get(index) !== kz) return false;
  return true;
}

/**
 * The editor's mutable state, held by reference like the floor plan's
 * GridSession and never put in React state: a stroke writes `edits` at
 * pointer rate. `floors` follows `band`; `setGroundBand` rebuilds it.
 */
export interface GroundSession {
  voxels: OccupiedVoxels;
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
