// The planner's remaining route, as a band on the floor.

import * as THREE from "three";

import type { Theme } from "@/lib/scene/theme";

/*
 * The route, in metres, as a band of real width rather than a THREE.Line:
 * WebGL ignores linewidth, so a line is a 1 px hairline that aliases away and
 * never thins with distance. 12 cm is legible across the map without hiding
 * the stops it runs through.
 */
const PATH_WIDTH_M = 0.12;
/* Route < stop (VERTEX_Z_M) < goal (MARKER_Z_M), so each draws over the one beneath. */
const PATH_Z_M = 0.012;

/**
 * One flat band following `points` (map-frame xy pairs), plus its disposer.
 * Rebuilt per update: a route arrives every ~3 s, and ~500 quads are cheaper
 * than a preallocated buffer across varying lengths. Null when there is no band
 * to make. `color` defaults to the route's; a dock's approach passes its own.
 */
export function createPathRibbon(
  points: Float32Array,
  theme: Theme,
  color: number = theme.path,
): { mesh: THREE.Mesh; dispose: () => void } | null {
  const n = points.length >> 1;
  if (n < 2) return null;

  const half = PATH_WIDTH_M / 2;
  const positions = new Float32Array(n * 6); // two vertices per point, xyz each
  const indices: number[] = [];

  for (let i = 0; i < n; i++) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];

    // Tangent from the neighbours (one-sided at the ends): both segments share
    // the offset vertices, so a corner joins with no overlap to double-blend.
    // The normal stays unit-length (no miter), so a corner pinches to
    // cos(turn / 2) instead of spiking — 71% at the planner's worst 90° step.
    const px = points[Math.max(0, i - 1) * 2];
    const py = points[Math.max(0, i - 1) * 2 + 1];
    const nx = points[Math.min(n - 1, i + 1) * 2];
    const ny = points[Math.min(n - 1, i + 1) * 2 + 1];

    let tx = nx - px;
    let ty = ny - py;
    const len = Math.hypot(tx, ty);
    if (len < 1e-6) {
      // Coincident neighbours (normally filtered upstream): a NaN in the
      // position buffer would blank the entire mesh.
      tx = 1;
      ty = 0;
    } else {
      tx /= len;
      ty /= len;
    }

    // Left normal of the tangent, in this z-up world.
    const ox = -ty * half;
    const oy = tx * half;

    const v = i * 6;
    positions[v] = x + ox;
    positions[v + 1] = y + oy;
    positions[v + 2] = PATH_Z_M;
    positions[v + 3] = x - ox;
    positions[v + 4] = y - oy;
    positions[v + 5] = PATH_Z_M;

    if (i > 0) {
      const a = (i - 1) * 2; // left vertex of the previous point
      indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  if (!indices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);

  // Double-sided: a grazing camera can catch the back face.
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: 0.75,
    side: THREE.DoubleSide,
  });

  const mesh = new THREE.Mesh(geometry, material);
  return {
    mesh,
    dispose: () => {
      geometry.dispose();
      material.dispose();
    },
  };
}
