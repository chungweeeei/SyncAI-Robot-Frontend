// The planner's remaining route, as a band on the floor.

import * as THREE from "three";

import type { Theme } from "@/lib/scene/theme";

/*
 * The planner's route, in metres.
 *
 * Drawn as a band of real width on the floor rather than as a THREE.Line, and
 * that is not a style preference: WebGL ignores LineBasicMaterial.linewidth, so
 * a line is a 1 px hairline at every distance — it aliases away down the length
 * of a warehouse and it does not get thinner as the camera pulls back, which is
 * the one cue that makes a perspective view readable. A band is also the same
 * language the vertex layer already speaks: everything the operator sees on the
 * floor here is ground marking, and nothing is an instrument overlay.
 *
 * 12 cm is roughly a tenth of the robot's width — legible from across the map,
 * and never wide enough to hide the stop marker it runs through.
 */
const PATH_WIDTH_M = 0.12;
/*
 * Below VERTEX_Z_M (0.02), which is itself below MARKER_Z_M (0.05). Route <
 * stop < goal, which is also the order they matter in: where it will go, where
 * it could go, where it was told to go. Each draws over the one beneath instead
 * of z-fighting with it.
 */
const PATH_Z_M = 0.012;

/**
 * One flat band following `points` (flat map-frame xy pairs), plus the disposer
 * for what it allocated.
 *
 * Built wholesale and thrown away on every update, like the vertex layer and for
 * a comparable reason: a route arrives about once every 3 s (the BT replans at
 * 0.333 Hz), and rebuilding ~500 quads at that rate is far cheaper than keeping
 * a preallocated buffer correct across paths of different lengths.
 *
 * Returns null for anything that cannot make a band — fewer than two points, or
 * a degenerate run where every point coincides.
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

    // Tangent from the neighbours (one-sided at the ends). Averaging the
    // incoming and outgoing directions is what joins a corner: both segments
    // share these two offset vertices, so the band stays continuous with no
    // join drawn — and, because the material is translucent, with no overlap to
    // double-blend into a darker patch at every turn.
    //
    // The offset keeps the normal unit-length instead of dividing by
    // cos(turn / 2), so a corner can never spike outward the way a true miter
    // can; it *pinches* instead, to cos(turn / 2) of the nominal width. That is
    // the failure mode worth having, and it needs no clamp: NavFn's worst case
    // is a 90-degree step between two 8-connected cells, which narrows the band
    // to 71% (4.2 cm of 6) for one quad — a slight waist, not an artefact. Only
    // a near-hairpin would thin to nothing, and a route that doubles back inside
    // one costmap cell is not something the planner emits.
    const px = points[Math.max(0, i - 1) * 2];
    const py = points[Math.max(0, i - 1) * 2 + 1];
    const nx = points[Math.min(n - 1, i + 1) * 2];
    const ny = points[Math.min(n - 1, i + 1) * 2 + 1];

    let tx = nx - px;
    let ty = ny - py;
    const len = Math.hypot(tx, ty);
    if (len < 1e-6) {
      // Coincident neighbours. The subscriber filters duplicates out, so this
      // is the second line of defence — and it has to be here, because an
      // unnormalisable tangent yields NaN offsets and a NaN in a position
      // buffer blanks the entire mesh, not just this quad.
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

  // Unlit and double-sided like every other mark on this floor: the band has to
  // keep its colour whichever way the route turns, and it is thin enough that a
  // grazing camera can catch its back face.
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
