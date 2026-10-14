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
 * for. Coloured by height over the 1st–99th percentile band, so a flight of
 * stairs reads as a flight and a stray voxel does not flatten the ramp.
 *
 * Opaque, which is what lets the translucent floor plan draw after it and
 * blend over it rather than hide it. Built wholesale and thrown away on any
 * change; `dispose` frees what it built, and the decoded keys stay with the
 * query cache.
 */
export function createVoxelLayer(voxels: OccupiedVoxels): VoxelLayer {
  const positions = voxelPositions(voxels);
  const { lo, hi } = heightRange(positions, 2, 3);
  const span = hi > lo ? hi - lo : 1;
  const colors = new Float32Array(positions.length);
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < positions.length; i += 3) {
    rampColor((positions[i + 2] - lo) / span, rgb);
    colors[i] = rgb[0];
    colors[i + 1] = rgb[1];
    colors[i + 2] = rgb[2];
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ size: voxels.res, vertexColors: true, sizeAttenuation: true }),
  );
  // No bounding sphere over a million points; the layer is the map, so
  // culling it could only ever be wrong.
  points.frustumCulled = false;

  return {
    points,
    frame: voxelFrame(voxels),
    dispose: () => {
      geometry.dispose();
      points.material.dispose();
    },
  };
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
