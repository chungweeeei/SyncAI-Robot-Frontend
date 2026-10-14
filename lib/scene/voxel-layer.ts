// The robot's 3D map on the viewport: every occupied voxel as one mark,
// coloured by height.

import * as THREE from "three";

import type { MapFrame } from "@/lib/scene/camera";
import type { Theme } from "@/lib/scene/theme";
import { heightRange, rampColor } from "@/lib/theme/height-ramp";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

export interface VoxelLayer {
  points: THREE.Points;
  /** The xy box the voxels cover, for framing a map that has no floor plan. */
  frame: MapFrame;
  /**
   * Draw only the cells whose centre lies in `[lo, hi)` metres, recoloured
   * over that band; `(-Infinity, Infinity)` is the whole map. A draw range
   * over the height-sorted buffer, so a floor switch moves two numbers and
   * repaints the band's colours rather than rebuilding the layer.
   */
  setBand: (lo: number, hi: number) => void;
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

/**
 * One `THREE.Points` with a world-sized sprite of exactly one cell, so the
 * floor tiles without gaps from above and a wall reads as a wall from the
 * oblique views the dashboard opens on. Points rather than an InstancedMesh
 * of boxes: a map runs to a million cells, which as boxes is tens of
 * millions of triangles and a per-instance matrix loop a phone cannot pay
 * for. Coloured by height over the 1st–99th percentile of what is drawn,
 * so a flight of stairs reads as a flight, a stray voxel does not flatten
 * the ramp, and one floor of a tall building gets the whole ramp to itself.
 * Held in height order so one floor is one draw range (see setBand).
 *
 * Opaque, which is what lets the translucent floor plan draw after it and
 * blend over it rather than hide it. Built wholesale and thrown away on any
 * change of map; `dispose` frees what it built, and the decoded keys stay
 * with the query cache.
 */
export function createVoxelLayer(voxels: OccupiedVoxels): VoxelLayer {
  const { order, levelStart } = sortByHeight(voxels);
  const unsorted = voxelPositions(voxels);
  const positions = new Float32Array(unsorted.length);
  for (let i = 0; i < voxels.count; i += 1) {
    const from = order[i] * 3;
    positions[i * 3] = unsorted[from];
    positions[i * 3 + 1] = unsorted[from + 1];
    positions[i * 3 + 2] = unsorted[from + 2];
  }
  const colors = new Float32Array(positions.length);
  const rgb: [number, number, number] = [0, 0, 0];

  /** Colour the marks `[start, end)` over their own 1st-99th percentile. */
  function paint(start: number, end: number) {
    const slice = positions.subarray(start * 3, end * 3);
    const { lo, hi } = heightRange(slice, 2, 3);
    const span = hi > lo ? hi - lo : 1;
    for (let i = start * 3; i < end * 3; i += 3) {
      rampColor((positions[i + 2] - lo) / span, rgb);
      colors[i] = rgb[0];
      colors[i + 1] = rgb[1];
      colors[i + 2] = rgb[2];
    }
  }
  paint(0, voxels.count);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const colorAttribute = new THREE.BufferAttribute(colors, 3);
  geometry.setAttribute("color", colorAttribute);
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: voxels.res, vertexColors: true, sizeAttenuation: true }),
  );
  // No bounding sphere over a million points; the layer is the map, so
  // culling it could only ever be wrong.
  points.frustumCulled = false;

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
    frame: voxelFrame(voxels),
    setBand: (lo, hi) => {
      const [a, b] = levels(lo, hi);
      const start = levelStart[a];
      const end = levelStart[b];
      geometry.setDrawRange(start, end - start);
      paint(start, end);
      colorAttribute.needsUpdate = true;
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
    },
  };
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

/**
 * Thin the floor plan's plane for as long as the 3D map is up, and return
 * what puts it back. The robot's floor lies about half a metre under the
 * plane (the map frame's zero is the body, not the ground), so at the
 * plane's usual opacity the whole map is hidden from every angle above it.
 * Thinned rather than lifted out of the way: the floor plan is still the
 * reference the stops and zones sit on. A no-op without a plane.
 *
 * The undo writes the theme's opacity rather than whatever was there before,
 * so two of these can never leave the plane stuck thin; after a scene
 * rebuild it lands on a disposed material, which is harmless.
 */
export function thinGroundUnderVoxels(ground: THREE.Mesh | null, theme: Theme): () => void {
  const material = ground?.material as THREE.MeshBasicMaterial | undefined;
  if (!material) return () => {};
  material.opacity = theme.groundOpacityUnderVoxels;
  return () => {
    material.opacity = theme.groundOpacity;
  };
}
