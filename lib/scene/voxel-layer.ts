// A stored map's 3D map — its walkable floor and its walls — as two point
// layers in the map frame.

import * as THREE from "three";

import type { Theme } from "@/lib/scene/theme";
import type { PointCloudFrame, VoxelLayerFrames } from "@/lib/types/pointcloud";

/**
 * The cell edge to draw at when the catalogue did not record one (layers on
 * disk with no build record beside them). The robot's default build size.
 */
export const VOXEL_SIZE_FALLBACK_M = 0.1;

function voxelPoints(frame: PointCloudFrame, size: number, color: number): THREE.Points {
  const geometry = new THREE.BufferGeometry();
  // Referenced, not copied: the frame is the query cache's and nothing writes
  // to it, the same arrangement as the map scan layer.
  geometry.setAttribute("position", new THREE.BufferAttribute(frame.positions, 3));
  const points = new THREE.Points(
    geometry,
    new THREE.PointsMaterial({ color, size, sizeAttenuation: true }),
  );
  // No bounding sphere is computed for hundreds of thousands of points; the
  // layer covers the map, so culling it would only ever be wrong.
  points.frustumCulled = false;
  return points;
}

/**
 * Both layers, each as one `THREE.Points` with a world-sized sprite of
 * exactly one cell, so the floor tiles without gaps from above.
 *
 * Points rather than an `InstancedMesh` of boxes: at the robot's 0.1 m the
 * two layers run to several hundred thousand cells, which as boxes is
 * millions of triangles and a per-instance matrix loop a phone cannot pay
 * for. The price is that a wall seen edge-on reads as a dense field of tiles
 * rather than as solid blocks; from the oblique and top-down views the
 * dashboard opens on, it reads as walls.
 *
 * Both materials are opaque, which is what lets the translucent floor plan
 * draw after them and blend over the floor layer rather than hide it.
 * Built wholesale and thrown away on any change; `dispose` frees what it
 * built and leaves the frames to the cache.
 */
export function createVoxelLayer(
  frames: VoxelLayerFrames,
  size: number,
  theme: Theme,
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const floor = voxelPoints(frames.road, size, theme.voxelFloor);
  const walls = voxelPoints(frames.occupied, size, theme.voxelWall);
  group.add(floor, walls);
  return {
    group,
    dispose: () => {
      for (const points of [floor, walls]) {
        points.geometry.dispose();
        (points.material as THREE.Material).dispose();
      }
    },
  };
}

/**
 * Thin the floor plan's plane for as long as the 3D map is up, and return
 * what puts it back. The floor layer sits about half a metre under the plane
 * (the map frame's zero is the robot's body, not the ground), so at the
 * plane's usual opacity it is only visible from underneath. A no-op without
 * a plane (a map with no floor plan).
 *
 * The undo writes the theme's opacity rather than whatever was there before,
 * so two of these can never leave the plane stuck thin, and after a scene
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
