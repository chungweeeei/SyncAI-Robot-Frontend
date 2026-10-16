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
 * to make.
 */
export function createPathRibbon(
  points: Float32Array,
  theme: Theme,
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
    color: theme.path,
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

/* A dash and its gap along a dashed band, in metres of floor. */
const DASH_ON_M = 0.12;
const DASH_OFF_M = 0.08;

/**
 * The pieces of a polyline (map-frame xy pairs) that carry a dash, as
 * [ax, ay, bx, by] each. The dash phase runs on across vertices rather than
 * restarting per segment, so a bend does not bunch the dashes up; a dash
 * that spans a vertex is split there, and the last one is clipped at the end
 * rather than overrunning it.
 */
export function dashPieces(
  points: Float32Array | readonly number[],
  on: number = DASH_ON_M,
  off: number = DASH_OFF_M,
): [number, number, number, number][] {
  const pieces: [number, number, number, number][] = [];
  if (!(on > 0)) return pieces;
  const period = on + Math.max(off, 0);
  const n = points.length >> 1;
  let travelled = 0;
  for (let i = 1; i < n; i++) {
    const ax = points[(i - 1) * 2];
    const ay = points[(i - 1) * 2 + 1];
    const dx = points[i * 2] - ax;
    const dy = points[i * 2 + 1] - ay;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-6)) continue;
    const tx = dx / length;
    const ty = dy / length;
    // Dash k covers [k * period, k * period + on] along the whole line. Stepping
    // by k rather than by a running phase is what keeps float error from
    // stalling the walk on a step too small to move it.
    const start = travelled;
    const end = travelled + length;
    for (let k = Math.floor(start / period); k * period < end; k++) {
      const from = Math.max(k * period, start) - start;
      const to = Math.min(k * period + on, end) - start;
      if (to > from) {
        pieces.push([ax + tx * from, ay + ty * from, ax + tx * to, ay + ty * to]);
      }
    }
    travelled += length;
  }
  return pieces;
}

/**
 * A dashed band following `points`, one quad per dash piece, plus its
 * disposer. Null when there is no dash to draw. `width` and `z` default to the
 * route's, so a dashed approach lies where the route would.
 */
export function createDashedRibbon(
  points: Float32Array | readonly number[],
  color: number,
  { width = PATH_WIDTH_M, z = PATH_Z_M, opacity = 0.85 } = {},
): { mesh: THREE.Mesh; dispose: () => void } | null {
  const half = width / 2;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [ax, ay, bx, by] of dashPieces(points)) {
    const length = Math.hypot(bx - ax, by - ay);
    if (!(length > 0)) continue;
    // Left normal, as in createPathRibbon.
    const ox = (-(by - ay) / length) * half;
    const oy = ((bx - ax) / length) * half;
    const v = positions.length / 3;
    positions.push(
      ax + ox, ay + oy, z,
      ax - ox, ay - oy, z,
      bx + ox, by + oy, z,
      bx - ox, by - oy, z,
    );
    indices.push(v, v + 1, v + 3, v, v + 3, v + 2);
  }
  if (!indices.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const material = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
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
