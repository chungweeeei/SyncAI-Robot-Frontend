// The robot's 3D map on the viewport: every occupied voxel as one mark,
// coloured by height.

import * as THREE from "three";

import type { MapFrame } from "@/lib/scene/camera";
import { heightRange, rampColor } from "@/lib/theme/height-ramp";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

export interface VoxelLayer {
  points: THREE.Points;
  /**
   * Every cell under the band, faint and in one neutral hue: the floors
   * below the one on show, for where it stands over them. Empty while the
   * whole map is drawn. Its own object, so a view that wants no context
   * (the editor's 3D view) simply does not add it.
   */
  ghost: THREE.Points;
  /** The xy box the voxels cover, for framing the map. */
  frame: MapFrame;
  /**
   * Draw only the cells whose centre lies in `[lo, hi)` metres, recoloured
   * over that band; `(-Infinity, Infinity)` is the whole map. A draw range
   * over the height-sorted buffer, so a floor switch moves two numbers and
   * repaints the band's colours rather than rebuilding the layer.
   * `ramp: "map"` colours over the whole map's heights instead: a band that
   * slides with the robot would otherwise recolour every cell on each move.
   * Only the cells whose colours change are repainted and uploaded, so a
   * `"map"` band after another paints nothing.
   */
  setBand: (lo: number, hi: number, options?: { ramp?: "band" | "map" }) => void;
  /**
   * The z the cells drawn in `[lo, hi)` span, cell edge to cell edge, or
   * null when the band holds none: what a side-on view frames.
   */
  zExtent: (lo: number, hi: number) => { lo: number; hi: number } | null;
  dispose: () => void;
}

/** Voxel centres in map-frame metres, one xyz triple per occupied cell. */
export function voxelPositions(voxels: OccupiedVoxels): Float32Array {
  const { keys, keyMin, res, count } = voxels;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count * 3; i += 3) {
    positions[i] = (keys[i] + keyMin[0] - OCTREE_KEY_ORIGIN + 0.5) * res;
    positions[i + 1] = (keys[i + 1] + keyMin[1] - OCTREE_KEY_ORIGIN + 0.5) * res;
    positions[i + 2] = (keys[i + 2] + keyMin[2] - OCTREE_KEY_ORIGIN + 0.5) * res;
  }
  return positions;
}

/** The xy box of the voxels, as `frameMap` wants it. */
export function voxelFrame(voxels: OccupiedVoxels): MapFrame {
  const { keyMin, size, res } = voxels;
  const x0 = (keyMin[0] - OCTREE_KEY_ORIGIN) * res;
  const y0 = (keyMin[1] - OCTREE_KEY_ORIGIN) * res;
  const widthM = size[0] * res;
  const heightM = size[1] * res;
  return { cx: x0 + widthM / 2, cy: y0 + heightM / 2, widthM, heightM };
}

/** How strongly the floors under the one on show come through. */
const GHOST_OPACITY = 0.14;

/**
 * One `THREE.Points` with a world-sized sprite of exactly one cell, so the
 * floor tiles without gaps from above and a wall reads as a wall from the
 * oblique views the dashboard opens on. Points rather than an InstancedMesh
 * of boxes: a map runs to a million cells, which as boxes is tens of
 * millions of triangles and a per-instance matrix loop a phone cannot pay
 * for. Coloured by height over the 1st–99th percentile of what is drawn,
 * so a flight of stairs reads as a flight, a stray voxel does not flatten
 * the ramp, and one floor of a tall building gets the whole ramp to itself.
 * Held in height order so one floor is one draw range (see setBand), as
 * 16-bit keys and byte colours, 9 bytes a cell where float xyz and rgb were
 * 24.
 *
 * Opaque, which is what lets translucent marks draw after it and blend over
 * it rather than hide it. Built wholesale and thrown away on any
 * change of map; `dispose` frees what it built, and the decoded keys stay
 * with the query cache.
 */
export function createVoxelLayer(
  voxels: OccupiedVoxels,
  { ghostColor = 0x808080 }: { ghostColor?: number } = {},
): VoxelLayer {
  const { count, res } = voxels;
  const { order, levelStart } = sortByHeight(voxels);
  // The cells' own relative keys rather than metres: half the bytes of
  // float xyz, on the GPU and in the heap, and exact. The object's scale and
  // position turn a key into the cell's centre (see placeOnKeys).
  const positions = new Uint16Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const from = order[i] * 3;
    positions[i * 3] = voxels.keys[from];
    positions[i * 3 + 1] = voxels.keys[from + 1];
    positions[i * 3 + 2] = voxels.keys[from + 2];
  }
  // Bytes, normalised by the GPU: what the screen shows anyway, at a quarter
  // of float colours' memory and of the upload a repaint costs.
  const colors = new Uint8Array(count * 3);
  const rgb: [number, number, number] = [0, 0, 0];

  // Over levels, not metres: a key is a linear map of a height, so the ramp
  // lands on the same colours.
  const whole = heightRange(positions, 2, 3);

  /**
   * Colour the marks `[start, end)` over `range`, by default their own
   * 1st-99th percentile, and queue just those bytes for upload.
   */
  function paint(start: number, end: number, range?: { lo: number; hi: number }) {
    if (end <= start) return;
    const { lo, hi } = range ?? heightRange(positions.subarray(start * 3, end * 3), 2, 3);
    const span = hi > lo ? hi - lo : 1;
    for (let i = start * 3; i < end * 3; i += 3) {
      rampColor((positions[i + 2] - lo) / span, rgb);
      colors[i] = Math.round(rgb[0] * 255);
      colors[i + 1] = Math.round(rgb[1] * 255);
      colors[i + 2] = Math.round(rgb[2] * 255);
    }
    colorAttribute.addUpdateRange(start * 3, (end - start) * 3);
    colorAttribute.needsUpdate = true;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colorAttribute = new THREE.BufferAttribute(colors, 3, true);
  geometry.setAttribute("color", colorAttribute);
  paint(0, count, whole);
  // The first upload is the whole buffer whatever the ranges say; cleared so
  // a stale range never rides along with a later one.
  colorAttribute.clearUpdateRanges();

  /**
   * The marks holding their own band's colours rather than the whole map's;
   * every other mark is in the whole map's. What lets a band that slides
   * with the robot (`ramp: "map"`) move two numbers and paint nothing.
   */
  let ownRamp: { start: number; end: number } | null = null;

  /** Put `[start, end)` back in the whole map's colours, but for `keep`. */
  function restore(from: { start: number; end: number }, keep?: { start: number; end: number }) {
    if (!keep) return paint(from.start, from.end, whole);
    paint(from.start, Math.min(from.end, keep.start), whole);
    paint(Math.max(from.start, keep.end), from.end, whole);
  }

  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: res, vertexColors: true, sizeAttenuation: true }),
  );
  placeOnKeys(points, voxels);
  // No bounding sphere over a million points; the layer is the map, so
  // culling it could only ever be wrong.
  points.frustumCulled = false;

  // The same positions, a second geometry for its own draw range. Translucent
  // and writing no depth, so it never hides what stands on it and is drawn
  // after the opaque floor on show.
  const ghostGeometry = new THREE.BufferGeometry();
  ghostGeometry.setAttribute("position", geometry.getAttribute("position"));
  ghostGeometry.setDrawRange(0, 0);
  const ghost = new THREE.Points(
    ghostGeometry,
    new THREE.PointsMaterial({
      size: voxels.res,
      sizeAttenuation: true,
      color: ghostColor,
      transparent: true,
      opacity: GHOST_OPACITY,
      depthWrite: false,
    }),
  );
  placeOnKeys(ghost, voxels);
  ghost.frustumCulled = false;

  /** The height levels (relative kz) whose centres lie in `[lo, hi)` metres. */
  function levels(lo: number, hi: number): [number, number] {
    const depth = voxels.size[2];
    const at = (z: number) =>
      Number.isFinite(z)
        ? Math.min(
            depth,
            Math.max(0, Math.ceil(z / voxels.res - 0.5 + OCTREE_KEY_ORIGIN - voxels.keyMin[2])),
          )
        : z < 0
          ? 0
          : depth;
    return [at(lo), Math.max(at(lo), at(hi))];
  }

  return {
    points,
    ghost,
    frame: voxelFrame(voxels),
    setBand: (lo, hi, { ramp = "band" } = {}) => {
      const [a, b] = levels(lo, hi);
      const start = levelStart[a];
      const end = levelStart[b];
      geometry.setDrawRange(start, end - start);
      ghostGeometry.setDrawRange(0, start);
      // The whole map's own band is the whole map's ramp.
      const own = ramp === "band" && (start > 0 || end < count) ? { start, end } : null;
      if (own && ownRamp && own.start === ownRamp.start && own.end === ownRamp.end) return;
      if (ownRamp) restore(ownRamp, own ?? undefined);
      if (own) paint(own.start, own.end);
      ownRamp = own;
    },
    zExtent: (lo, hi) => {
      const [a, b] = levels(lo, hi);
      let first = a;
      while (first < b && levelStart[first + 1] === levelStart[first]) first += 1;
      let last = b - 1;
      while (last >= first && levelStart[last + 1] === levelStart[last]) last -= 1;
      if (first >= b || last < first) return null;
      const base = voxels.keyMin[2] - OCTREE_KEY_ORIGIN;
      return { lo: (base + first) * voxels.res, hi: (base + last + 1) * voxels.res };
    },
    dispose: () => {
      geometry.dispose();
      points.material.dispose();
      ghostGeometry.dispose();
      ghost.material.dispose();
    },
  };
}

/**
 * Scale and move marks whose positions are relative keys onto the cells'
 * centres in metres: `(key + keyMin - origin + 0.5) * res` on each axis, as
 * voxelPositions writes them. The sprite's size is not scaled with it, so
 * it stays `res` metres across.
 */
function placeOnKeys(object: THREE.Object3D, voxels: OccupiedVoxels) {
  const [x, y, z] = voxels.keyMin.map((k) => (k - OCTREE_KEY_ORIGIN + 0.5) * voxels.res);
  object.position.set(x, y, z);
  object.scale.setScalar(voxels.res);
}

/**
 * The cells in height order, by a counting sort on their relative kz (a
 * map is a few hundred levels deep, so this is two passes, not a sort), and
 * where each level starts in that order: `levelStart[k]` to
 * `levelStart[k + 1]` are the cells at level `k`. Stable, so cells keep the
 * tree's order within a level.
 */
export function sortByHeight(voxels: OccupiedVoxels): {
  order: Uint32Array;
  levelStart: Uint32Array;
} {
  const depth = voxels.size[2];
  const levelStart = new Uint32Array(depth + 1);
  for (let i = 0; i < voxels.count; i += 1) levelStart[voxels.keys[i * 3 + 2] + 1] += 1;
  for (let k = 0; k < depth; k += 1) levelStart[k + 1] += levelStart[k];
  const next = levelStart.slice(0, depth);
  const order = new Uint32Array(voxels.count);
  for (let i = 0; i < voxels.count; i += 1) order[next[voxels.keys[i * 3 + 2]]++] = i;
  return { order, levelStart };
}
