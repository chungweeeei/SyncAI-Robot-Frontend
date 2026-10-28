// The 3D view's brush rules: where a brush aims, which columns of the 3D
// map it may fill, at what height, and the record of what it filled. Pure,
// so the component only acts on them (lib/map/grid.ts's stamps do the disc).
//
// The lidar sees the floor only at grazing angles, and the robot's own fill
// closes only enclosed gaps, so a floor no ray looked into stays unknown and
// the planner refuses it. An operator who knows it is floor paints it here;
// the backend records the result (octomap_edits.json) and the robot's tool
// writes it into the tree. Where the ground is (each column's floor, the
// floor a band mostly stands on, the column under a point) is
// lib/map/ground.ts, which waypoint placement reads too.
//
// Every rule here is local to the surface the brush is on, not to the floor
// picked: a staircase is not one height, and a flight can stand over the
// ground or over another flight. So the brush aims at the surface under the
// pointer (aimSurface), a hole is set at the height of the surface nearest
// it within a window of that aim (patchHeight), and a column is a hole when
// nothing is near that height in it (isHole) — whatever lies a storey under
// it.

import {
  type Band,
  type ColumnFloors,
  type ColumnStacks,
  columnFloors,
  columnStacks,
  fullBand,
  type GridSize,
  NO_FLOOR,
  occupiedIn,
  surfaceNear,
} from "@/lib/map/ground";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

/**
 * Every column of a disc `diameter` columns wide centred on (col, row),
 * clipped to the grid — one call of `sink` per column index (`col + row *
 * width`). The brush's footprint: a diameter of one is the column alone.
 */
function stampDisc(
  size: GridSize,
  col: number,
  row: number,
  diameter: number,
  sink: (index: number) => void,
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
      sink(base + dx);
    }
  }
}

/**
 * How many surface cells a patch's height is read from, the nearest ones:
 * fewer and the height would be one cell's guess.
 */
export const MIN_FLOOR_SAMPLES = 5;

/**
 * The band above a filled floor that must hold no voxel: the planner's
 * body_clearance, which the robot's tool marks free. A voxel in it means
 * the column is not a hole — a ramp a little off the patch, a wall foot,
 * an obstacle — and a floor slipped under it would only mislead the planner.
 */
export const CLEARANCE_M = 0.6;

/** How far from a hole its height is read, metres. */
export const LOCAL_FLOOR_RING_M = 1.0;

/**
 * How far above or below the aim a surface is read as the one the brush is
 * on, metres. Two or three steps of a stair, so a patch on a tread is read
 * off the treads around it; short of a storey, so neither the ground under
 * a flight nor the flight over it is.
 */
export const SURFACE_WINDOW_M = 0.5;

/**
 * How far under a patch a cell still makes its column floor already,
 * metres: the floor itself, seen a cell or two low. Deeper is another
 * surface — the ground under a flight, a landing below — and leaves the
 * column a hole at this height.
 */
export const HOLE_DEPTH_M = 0.2;

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

/** The fill's distances at a tree's resolution, cells. */
export interface FillReach {
  /** How far from a hole its height is read. */
  ring: number;
  /** How far from the aim a surface counts as the brush's. */
  window: number;
  /** How far under a patch a cell makes the column floor already. */
  depth: number;
  /** The clearance band a hole must be empty through. */
  clearance: number;
}

export function fillReach(res: number): FillReach {
  return {
    ring: cellsFor(LOCAL_FLOOR_RING_M, res),
    window: cellsFor(SURFACE_WINDOW_M, res),
    depth: cellsFor(HOLE_DEPTH_M, res),
    clearance: clearanceCells(res),
  };
}

/** The operator's patches: column index -> relative kz of the filled cell. */
export type GroundEdits = Map<number, number>;

/**
 * The surface a column offers the brush aimed at `aim`: a patch, else the
 * surface nearest the aim within the window, or NO_FLOOR.
 */
function surfaceFor(
  stacks: ColumnStacks,
  edits: GroundEdits,
  column: number,
  aim: number,
  window: number,
): number {
  const patched = edits.get(column);
  if (patched !== undefined) return Math.abs(patched - aim) <= window ? patched : NO_FLOOR;
  return surfaceNear(stacks, column, aim, aim - window, aim + window);
}

/**
 * The height a hole at (col, row) is filled at: the median of the
 * MIN_FLOOR_SAMPLES surfaces nearest it (earlier patches included) within
 * `reach.ring` cells and `reach.window` of the aim, or null with fewer to
 * read. The nearest rather than every one in reach, so a hole in a tread
 * takes that tread's height and not the stair's mean; a median, so a stray
 * cell among them does not sink it.
 */
export function patchHeight(
  stacks: ColumnStacks,
  edits: GroundEdits,
  col: number,
  row: number,
  aim: number,
  reach: FillReach,
): number | null {
  const { width, height } = stacks;
  const { ring, window } = reach;
  const samples: { d2: number; kz: number }[] = [];
  const take = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const d2 = (x - col) ** 2 + (y - row) ** 2;
    // The brush's own disc rule (stampDisc), so a ring of one is the 3×3.
    if (d2 > ring * ring + ring) return;
    const kz = surfaceFor(stacks, edits, x + y * width, aim, window);
    if (kz !== NO_FLOOR) samples.push({ d2, kz });
  };
  // Square rings outward, stopping once no unread ring can hold a nearer
  // sample than the ones in hand: a hole beside its floor reads a few cells.
  for (let d = 0; d <= ring; d += 1) {
    if (d === 0) take(col, row);
    for (let i = -d; i <= d && d > 0; i += 1) {
      take(col + i, row - d);
      take(col + i, row + d);
      if (i !== -d && i !== d) {
        take(col - d, row + i);
        take(col + d, row + i);
      }
    }
    if (samples.length >= MIN_FLOOR_SAMPLES) {
      samples.sort((a, b) => a.d2 - b.d2);
      if (samples[MIN_FLOOR_SAMPLES - 1].d2 <= d * d) break;
    }
  }
  if (samples.length < MIN_FLOOR_SAMPLES) return null;
  samples.sort((a, b) => a.d2 - b.d2);
  const nearest = samples
    .slice(0, MIN_FLOOR_SAMPLES)
    .map((s) => s.kz)
    .sort((a, b) => a - b);
  return nearest[MIN_FLOOR_SAMPLES >> 1];
}

/**
 * Whether a column is a hole a floor at `f` may go into: nothing occupied
 * from just under it up through the clearance band. A cell there is floor
 * already, or something standing on it; a cell further down is another
 * surface, and does not stop a patch over it.
 */
export function isHole(stacks: ColumnStacks, index: number, f: number, reach: FillReach): boolean {
  return !occupiedIn(stacks, index, f - reach.depth, f + reach.clearance);
}

/**
 * A ray from the camera, map-frame metres: `origin` and a unit `direction`.
 * Plain numbers, so the rule needs no three.js.
 */
export interface Ray {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

/**
 * The surface a pointer aims the brush at: the surface cell (the top of a
 * run, or a patch) inside the band shown that lies within `reach` metres of
 * the ray and nearest the camera, as relative kz; null when none does. A
 * reach about the brush's size, so a pointer over a hole takes the hole's
 * rim and not what the ray meets through it — the ground under a flight.
 * A wall's face is not a surface, so it does not take the stroke.
 */
export function aimSurface(
  voxels: OccupiedVoxels,
  stacks: ColumnStacks,
  edits: GroundEdits,
  band: Band,
  ray: Ray,
  reach: number,
): number | null {
  const { res, keyMin, keys, count } = voxels;
  const [width] = voxels.size;
  const { origin: o, direction: d } = ray;
  const reach2 = reach * reach;
  const x0 = (keyMin[0] - OCTREE_KEY_ORIGIN + 0.5) * res - o.x;
  const y0 = (keyMin[1] - OCTREE_KEY_ORIGIN + 0.5) * res - o.y;
  const z0 = (keyMin[2] - OCTREE_KEY_ORIGIN + 0.5) * res - o.z;
  /** How far along the ray a cell lies, or Infinity when it is off it or behind. */
  const along = (kx: number, ky: number, kz: number) => {
    if (kz < band.lo || kz > band.hi) return Infinity;
    const vx = x0 + kx * res;
    const vy = y0 + ky * res;
    const vz = z0 + kz * res;
    const t = vx * d.x + vy * d.y + vz * d.z;
    if (t <= 0 || vx * vx + vy * vy + vz * vz - t * t > reach2) return Infinity;
    return t;
  };
  let best: number | null = null;
  let bestT = Infinity;
  // Every cell, not a march along the ray: one pass a pointer move, and
  // a map is a few hundred thousand cells.
  for (let i = 0; i < count * 3; i += 3) {
    const kz = keys[i + 2];
    const t = along(keys[i], keys[i + 1], kz);
    if (t >= bestT) continue;
    if (occupiedIn(stacks, keys[i] + keys[i + 1] * width, kz + 1, kz + 1)) continue;
    bestT = t;
    best = kz;
  }
  for (const [column, kz] of edits) {
    const t = along(column % width, Math.floor(column / width), kz);
    if (t >= bestT) continue;
    bestT = t;
    best = kz;
  }
  return best;
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
 * Fill the holes under a brush disc aimed at the surface `aim` (relative
 * kz), each at the height of the surface nearest it. Returns the columns
 * that changed (for the repaint), empty when the dab found no surface to
 * read or no hole to fill. Heights are read before any is written, so a
 * dab's result does not depend on the order its columns are visited in.
 */
export function fillDab(
  stacks: ColumnStacks,
  edits: GroundEdits,
  stroke: GroundStroke,
  col: number,
  row: number,
  radius: number,
  aim: number,
  reach: FillReach,
): number[] {
  const fills: [number, number][] = [];
  const { width } = stacks;
  stampDisc(stacks, col, row, 2 * radius + 1, (index) => {
    if (edits.has(index)) return;
    const f = patchHeight(stacks, edits, index % width, Math.floor(index / width), aim, reach);
    if (f === null || !isHole(stacks, index, f, reach)) return;
    fills.push([index, f]);
  });
  for (const [index, f] of fills) {
    stroke.record(index, NO_FLOOR);
    edits.set(index, f);
  }
  return fills.map(([index]) => index);
}

/**
 * Take the operator's own patches back out from under the disc, at any
 * height: a patch is only ever in a column the operator painted.
 */
export function eraseDab(
  size: GridSize,
  edits: GroundEdits,
  stroke: GroundStroke,
  col: number,
  row: number,
  radius: number,
): number[] {
  const changed: number[] = [];
  stampDisc(size, col, row, 2 * radius + 1, (index) => {
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
 * The editor's mutable state, held by reference and never put in React
 * state: a stroke writes `edits` at
 * pointer rate. `floors` follows `band`; `setGroundBand` rebuilds it. The
 * brush reads `stacks`, which do not: the band limits what it aims at, not
 * what a surface is.
 */
export interface GroundSession {
  voxels: OccupiedVoxels;
  size: GridSize;
  band: Band;
  floors: ColumnFloors;
  /** Every column's cells, whatever the band: what the brush's rules read. */
  stacks: ColumnStacks;
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
    stacks: columnStacks(voxels),
    edits,
  };
}

export function setGroundBand(session: GroundSession, band: Band): void {
  session.band = band;
  session.floors = columnFloors(session.voxels, band);
}
