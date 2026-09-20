// Sizing and colouring for the two point clouds.

import * as THREE from "three";

// Upper bound on live points held in the GPU buffer. The backend caps frames
// (default 30k) well below this; the slack absorbs config changes without a
// reallocation.
export const MAX_LIVE_POINTS = 200_000;

// Fixed height band (metres, map frame) used to colour points by z. A fixed
// range keeps colours stable frame-to-frame instead of flickering with the
// per-frame min/max.
const Z_MIN = -0.5;
const Z_MAX = 3.0;

// Point sizes (metres — PointsMaterial keeps sizeAttenuation on, so these are
// world units that shrink with distance, not screen pixels). The live body
// cloud is drawn small and fine: at ~2.5k points per scan, sprites large enough
// to see individually also merge into blobs that hide the structure of what the
// lidar actually saw. The map cloud stays coarser — it is decimated to a 0.3 m
// voxel, so drawing it finer than that only makes it look sparse.
export const LIVE_POINT_SIZE = 0.05;
export const MAP_POINT_SIZE = 0.14;

/** Map a height to an RGB colour (blue = low, red = high) via an HSL sweep. */
export function heightColor(z: number, out: THREE.Color): THREE.Color {
  const t = Math.min(1, Math.max(0, (z - Z_MIN) / (Z_MAX - Z_MIN)));
  // hue 240deg (blue) -> 0deg (red)
  return out.setHSL(((1 - t) * 240) / 360, 0.9, 0.55);
}
