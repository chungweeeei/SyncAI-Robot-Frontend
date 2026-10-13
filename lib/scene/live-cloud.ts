// Sizing and colouring for the two point clouds.

import * as THREE from "three";

// GPU buffer capacity; well above the backend's frame cap (default 30k), so a
// config change needs no reallocation.
export const MAX_LIVE_POINTS = 200_000;

// Fixed height band (metres) for colouring by z, so colours do not flicker frame to frame.
const Z_MIN = -0.5;
const Z_MAX = 3.0;

// Point sizes in world metres (sizeAttenuation on). The live scan is fine so
// points do not merge into blobs; the map scan is coarser to match its 0.3 m
// voxels, or it looks sparse.
export const LIVE_POINT_SIZE = 0.05;
export const MAP_POINT_SIZE = 0.14;

/** Map a height to an RGB colour (blue = low, red = high) via an HSL sweep. */
export function heightColor(z: number, out: THREE.Color): THREE.Color {
  const t = Math.min(1, Math.max(0, (z - Z_MIN) / (Z_MAX - Z_MIN)));
  // hue 240deg (blue) -> 0deg (red)
  return out.setHSL(((1 - t) * 240) / 360, 0.9, 0.55);
}
