// The ground patches in 3D: one mark per patched column, at the
// height the patch was set to, in the commanded hue.

import * as THREE from "three";

import type { GroundEdits } from "@/lib/map/ground-fill";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

/**
 * How much larger a patch's mark is than a cell. A patch sits exactly where
 * a voxel would, and the same size would z-fight with the floor beside it;
 * a little larger reads as "on top" from any angle.
 */
export const PATCH_MARK_SCALE = 1.15;

export interface PatchLayer {
  points: THREE.Points;
  dispose: () => void;
}

/** Patch centres in map-frame metres, one xyz triple per patched column. */
export function patchPositions(edits: GroundEdits, voxels: OccupiedVoxels): Float32Array {
  const { keyMin, res } = voxels;
  const width = voxels.size[0];
  const positions = new Float32Array(edits.size * 3);
  let i = 0;
  for (const [column, kz] of edits) {
    const x = column % width;
    const y = Math.floor(column / width);
    positions[i] = (x + keyMin[0] - OCTREE_KEY_ORIGIN + 0.5) * res;
    positions[i + 1] = (y + keyMin[1] - OCTREE_KEY_ORIGIN + 0.5) * res;
    positions[i + 2] = (kz + keyMin[2] - OCTREE_KEY_ORIGIN + 0.5) * res;
    i += 3;
  }
  return positions;
}

/**
 * The patches as one `THREE.Points` in one colour, rebuilt on every change:
 * a map's worth is tens of thousands of marks, a fraction of the tree's.
 */
export function createPatchLayer(
  edits: GroundEdits,
  voxels: OccupiedVoxels,
  color: number,
): PatchLayer {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(patchPositions(edits, voxels), 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: voxels.res * PATCH_MARK_SCALE, color, sizeAttenuation: true }),
  );
  points.frustumCulled = false;
  return {
    points,
    dispose: () => {
      geometry.dispose();
      points.material.dispose();
    },
  };
}
