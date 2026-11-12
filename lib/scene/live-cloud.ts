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

/*
 * The sweep, tabulated. A frame is up to 30k points ten times a second, and
 * an HSL conversion with its colour-space step for each was 300k of them a
 * second for a ramp nobody can tell from 1024 steps of it (a step is under a
 * quarter of a degree of hue).
 */
const HEIGHT_LUT_STEPS = 1024;
const HEIGHT_LUT = (() => {
  const lut = new Float32Array(HEIGHT_LUT_STEPS * 3);
  const color = new THREE.Color();
  for (let i = 0; i < HEIGHT_LUT_STEPS; i += 1) {
    heightColor(Z_MIN + (i / (HEIGHT_LUT_STEPS - 1)) * (Z_MAX - Z_MIN), color);
    lut[i * 3] = color.r;
    lut[i * 3 + 1] = color.g;
    lut[i * 3 + 2] = color.b;
  }
  return lut;
})();

/** `heightColor` written straight into a colour buffer at `offset`, from the table. */
export function writeHeightColor(z: number, out: Float32Array, offset: number): void {
  const t = Math.min(1, Math.max(0, (z - Z_MIN) / (Z_MAX - Z_MIN)));
  const i = Math.round(t * (HEIGHT_LUT_STEPS - 1)) * 3;
  out[offset] = HEIGHT_LUT[i];
  out[offset + 1] = HEIGHT_LUT[i + 1];
  out[offset + 2] = HEIGHT_LUT[i + 2];
}
