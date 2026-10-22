// The planner's remaining route, as a band on the ground it crosses.

import * as THREE from "three";

import { GROUND_FLOOR_Z_M, drawnGround } from "@/lib/map/floors";
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
/*
 * The pale edge each side of the route. Over the 3D map the band crosses
 * every hue of the height ramp, cyan and green among them, so no core hue
 * alone holds an edge; a light rim beside a saturated core does, as a
 * stop's ring does (vertexHalo). A road on a satellite map is drawn the
 * same way, for the same reason.
 */
const PATH_CASING_M = 0.03;
/*
 * How strongly a band shows where something stands in front of it: a wall,
 * the robot's own body, or the cell-sized sprites of the floor, which face
 * the camera and so stand up through a band at the ground from any oblique
 * view. Faint, so an occluded stretch still reads as behind, but never gone:
 * a route that vanishes into the map is the complaint this answers.
 */
const GHOST_OPACITY = 0.35;
/*
 * Pulls the band toward the camera in depth by a few pixels' worth of its
 * own slope, so the floor's sprites stop speckling it at a grazing angle.
 * A slope term, so it is nothing from straight overhead, where nothing
 * stands up through the band, and too small to reach through a wall.
 */
const POLYGON_OFFSET = -4;
/*
 * How far the casing lies under its core. On one plane the two are cut into
 * different triangles that interpolate depth a hair apart, and the casing
 * striped through the core; 4 mm is well over the depth buffer's step at
 * any distance the map is read from, and still over the floor plan.
 */
const CASING_DROP_M = 0.004;
/*
 * Chevrons along the route, pointing the way the robot will go: a band says
 * where, not which way, and from a tilted view the goal it ends on can be
 * off screen. One every 0.8 m, from 0.6 m out so the first is clear of the
 * robot's feet, and none within 0.3 m of the end, where the goal marker is.
 * Inside the core, in the casing's pale hue, and just over the core.
 */
const ARROW_SPACING_M = 0.8;
const ARROW_FIRST_M = 0.6;
const ARROW_END_CLEAR_M = 0.3;
const ARROW_LENGTH_M = 0.13;
const ARROW_WIDTH_M = 0.1;
/* How far back the notch is cut into the chevron, of its length. */
const ARROW_NOTCH = 0.5;
const ARROW_LIFT_M = 0.004;

/**
 * Where each chevron of a route goes: a point, the unit heading of the
 * segment it lies on, and that segment's index (the segment from point i - 1
 * to point i is `i`), so a floor filter can drop it with its segment. Walks
 * the ground plane, so a step straight up carries none.
 */
export function arrowStations(
  points: Float32Array | readonly number[],
  { spacing = ARROW_SPACING_M, first = ARROW_FIRST_M, endClear = ARROW_END_CLEAR_M } = {},
): { x: number; y: number; z: number; tx: number; ty: number; segment: number }[] {
  const n = Math.floor(points.length / 3);
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += Math.hypot(points[i * 3] - points[(i - 1) * 3], points[i * 3 + 1] - points[(i - 1) * 3 + 1]);
  }
  const stations: { x: number; y: number; z: number; tx: number; ty: number; segment: number }[] = [];
  let next = first;
  let travelled = 0;
  for (let i = 1; i < n && next <= total - endClear; i++) {
    const ax = points[(i - 1) * 3];
    const ay = points[(i - 1) * 3 + 1];
    const az = points[(i - 1) * 3 + 2];
    const dx = points[i * 3] - ax;
    const dy = points[i * 3 + 1] - ay;
    const dz = points[i * 3 + 2] - az;
    const length = Math.hypot(dx, dy);
    if (!(length > 1e-6)) continue;
    while (next <= travelled + length && next <= total - endClear) {
      const f = (next - travelled) / length;
      stations.push({
        x: ax + dx * f,
        y: ay + dy * f,
        z: az + dz * f,
        tx: dx / length,
        ty: dy / length,
        segment: i,
      });
      next += spacing;
    }
    travelled += length;
  }
  return stations;
}

/*
 * The ghost draws before every other translucent mark and with no depth
 * test, so whatever is in front paints over it; then the casing, then the
 * core on the casing's own depth.
 */
const GHOST_RENDER_ORDER = -3;
const CASING_RENDER_ORDER = -2;
const CORE_RENDER_ORDER = -1;

/**
 * A band and its companions, as one object to add: `mesh` is the core, and
 * its children are the ghost (the core's geometry again, drawn through
 * whatever hides it), the casing (a wider band of its own) and, on the
 * route, its chevrons.
 */
interface Ribbon {
  mesh: THREE.Mesh;
  dispose: () => void;
}

/** A ribbon that can change hue in place, materials and all, without a rebuild. */
interface StackedRibbon extends Ribbon {
  recolor: (color: number, casingColor?: number) => void;
}

function bandMaterial(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    // Double-sided: a grazing camera can catch the back face.
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: POLYGON_OFFSET,
    polygonOffsetUnits: POLYGON_OFFSET,
  });
}

/** The core over `casing` (when there is one) over its ghost. */
function stackRibbon(
  core: THREE.BufferGeometry,
  casing: THREE.BufferGeometry | null,
  { color, opacity, casingColor }: { color: number; opacity: number; casingColor?: number },
): StackedRibbon {
  const coreMaterial = bandMaterial(color, opacity);
  const mesh = new THREE.Mesh(core, coreMaterial);
  mesh.renderOrder = CORE_RENDER_ORDER;

  const ghostMaterial = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: GHOST_OPACITY,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
  });
  const ghost = new THREE.Mesh(core, ghostMaterial);
  ghost.renderOrder = GHOST_RENDER_ORDER;
  mesh.add(ghost);

  let casingMaterial: THREE.MeshBasicMaterial | null = null;
  if (casing && casingColor !== undefined) {
    // Opaque, so the core lies on a clean edge rather than on the casing
    // blended with whatever hue of the map is under it.
    casingMaterial = bandMaterial(casingColor, 1);
    const rim = new THREE.Mesh(casing, casingMaterial);
    rim.renderOrder = CASING_RENDER_ORDER;
    mesh.add(rim);
  }

  return {
    mesh,
    recolor: (next, nextCasing) => {
      coreMaterial.color.setHex(next);
      ghostMaterial.color.setHex(next);
      if (nextCasing !== undefined) casingMaterial?.color.setHex(nextCasing);
    },
    dispose: () => {
      core.dispose();
      casing?.dispose();
      coreMaterial.dispose();
      ghostMaterial.dispose();
      casingMaterial?.dispose();
    },
  };
}

export interface PathRibbon {
  /** The core band; the ghost, the casing and the chevrons are its children. */
  mesh: THREE.Mesh;
  /**
   * Draw only the stretches on one floor: a segment whose two ends both
   * stand in [lo, hi). ±Infinity is every floor, the whole route.
   */
  setBand: (lo: number, hi: number) => void;
  /**
   * Whether the 3D map is drawn under it, which swaps the route's hues for
   * `pathOverMap` and `pathCasingOverMap`, chevrons included.
   */
  setOverMap: (over: boolean) => void;
  dispose: () => void;
}

/**
 * One band following `points` (map-frame [x, y, z] triples, z the ground under
 * each), plus its floor filter and disposer. Rebuilt per update: a route
 * arrives every ~3 s, and ~500 quads are cheaper than a preallocated buffer
 * across varying lengths. Null when there is no band to make.
 */
export function createPathRibbon(points: Float32Array, theme: Theme): PathRibbon | null {
  const n = Math.floor(points.length / 3);
  if (n < 2) return null;

  const half = PATH_WIDTH_M / 2;
  const casingHalf = half + PATH_CASING_M;
  const positions = new Float32Array(n * 6); // two vertices per point, xyz each
  const casingPositions = new Float32Array(n * 6);

  for (let i = 0; i < n; i++) {
    const x = points[i * 3];
    const y = points[i * 3 + 1];
    // Never under the floor plan: a planner's ground on the ground floor
    // wanders a few centimetres around it with the odometry's drift, and
    // under it the whole route would be out of sight beneath the plan.
    const z = Math.max(drawnGround(points[i * 3 + 2]), GROUND_FLOOR_Z_M) + PATH_Z_M;

    // Tangent from the neighbours (one-sided at the ends), in the ground
    // plane: both segments share the offset vertices, so a corner joins with
    // no overlap to double-blend. The normal stays unit-length (no miter), so
    // a corner pinches to cos(turn / 2) instead of spiking — 71% at the
    // planner's worst 90° step.
    const px = points[Math.max(0, i - 1) * 3];
    const py = points[Math.max(0, i - 1) * 3 + 1];
    const nx = points[Math.min(n - 1, i + 1) * 3];
    const ny = points[Math.min(n - 1, i + 1) * 3 + 1];

    let tx = nx - px;
    let ty = ny - py;
    const len = Math.hypot(tx, ty);
    if (len < 1e-6) {
      // Coincident neighbours, or a step straight up: a NaN in the position
      // buffer would blank the entire mesh.
      tx = 1;
      ty = 0;
    } else {
      tx /= len;
      ty /= len;
    }

    // Left normal of the tangent, in this z-up world.
    const v = i * 6;
    for (const [out, w, h] of [
      [positions, half, z],
      [casingPositions, casingHalf, z - CASING_DROP_M],
    ] as const) {
      out[v] = x - ty * w;
      out[v + 1] = y + tx * w;
      out[v + 2] = h;
      out[v + 3] = x + ty * w;
      out[v + 4] = y - tx * w;
      out[v + 5] = h;
    }
  }

  /** The quads of the segments whose two ends stand on [lo, hi). */
  const indicesIn = (lo: number, hi: number) => {
    const indices: number[] = [];
    let previousOn = false;
    for (let i = 0; i < n; i++) {
      const ground = drawnGround(points[i * 3 + 2]);
      const on = ground >= lo && ground < hi;
      if (i > 0 && on && previousOn) {
        const a = (i - 1) * 2; // left vertex of the previous point
        indices.push(a, a + 1, a + 3, a, a + 3, a + 2);
      }
      previousOn = on;
    }
    return indices;
  };

  const all = indicesIn(-Infinity, Infinity);
  if (!all.length) return null;

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(all);
  const casing = new THREE.BufferGeometry();
  casing.setAttribute("position", new THREE.BufferAttribute(casingPositions, 3));
  casing.setIndex(all);

  const { mesh, recolor, dispose: disposeBand } = stackRibbon(geometry, casing, {
    color: theme.path,
    opacity: 1,
    casingColor: theme.pathCasing,
  });

  // Two triangles a chevron, tip, back corners and the notch between them.
  const stations = arrowStations(points);
  const arrowPositions = new Float32Array(stations.length * 4 * 3);
  stations.forEach(({ x, y, z: ground, tx, ty }, k) => {
    const z = Math.max(drawnGround(ground), GROUND_FLOOR_Z_M) + PATH_Z_M + ARROW_LIFT_M;
    const l = ARROW_LENGTH_M / 2;
    const w = ARROW_WIDTH_M / 2;
    const corners = [
      [x + tx * l, y + ty * l],
      [x - tx * l - ty * w, y - ty * l + tx * w],
      [x - tx * l * (1 - 2 * ARROW_NOTCH), y - ty * l * (1 - 2 * ARROW_NOTCH)],
      [x - tx * l + ty * w, y - ty * l - tx * w],
    ];
    corners.forEach(([cx, cy], c) => arrowPositions.set([cx, cy, z], (k * 4 + c) * 3));
  });
  /** The chevrons whose segment is drawn in [lo, hi). */
  const arrowIndicesIn = (lo: number, hi: number) => {
    const indices: number[] = [];
    stations.forEach(({ segment }, k) => {
      const on = (i: number) => {
        const ground = drawnGround(points[i * 3 + 2]);
        return ground >= lo && ground < hi;
      };
      if (!on(segment - 1) || !on(segment)) return;
      const v = k * 4;
      indices.push(v, v + 1, v + 2, v, v + 2, v + 3);
    });
    return indices;
  };
  const arrowGeometry = new THREE.BufferGeometry();
  arrowGeometry.setAttribute("position", new THREE.BufferAttribute(arrowPositions, 3));
  arrowGeometry.setIndex(arrowIndicesIn(-Infinity, Infinity));
  const arrowMaterial = bandMaterial(theme.pathCasing, 1);
  const arrows = new THREE.Mesh(arrowGeometry, arrowMaterial);
  arrows.renderOrder = CORE_RENDER_ORDER;
  mesh.add(arrows);
  const dispose = () => {
    disposeBand();
    arrowGeometry.dispose();
    arrowMaterial.dispose();
  };

  let bandLo = -Infinity;
  let bandHi = Infinity;
  const setBand = (lo: number, hi: number) => {
    if (lo === bandLo && hi === bandHi) return;
    bandLo = lo;
    bandHi = hi;
    const indices = indicesIn(lo, hi);
    geometry.setIndex(indices);
    casing.setIndex(indices);
    arrowGeometry.setIndex(arrowIndicesIn(lo, hi));
  };

  const setOverMap = (over: boolean) => {
    const casingColor = over ? theme.pathCasingOverMap : theme.pathCasing;
    recolor(over ? theme.pathOverMap : theme.path, casingColor);
    arrowMaterial.color.setHex(casingColor);
  };

  return { mesh, setBand, setOverMap, dispose };
}

/* A dash and its gap along a dashed band, in metres of floor. */
const DASH_ON_M = 0.12;
const DASH_OFF_M = 0.08;

/**
 * The pieces of a polyline (map-frame points, `stride` numbers each with x and
 * y first) that carry a dash, as [ax, ay, bx, by] each. The dash phase runs on across vertices rather than
 * restarting per segment, so a bend does not bunch the dashes up; a dash
 * that spans a vertex is split there, and the last one is clipped at the end
 * rather than overrunning it.
 */
export function dashPieces(
  points: Float32Array | readonly number[],
  on: number = DASH_ON_M,
  off: number = DASH_OFF_M,
  stride = 2,
): [number, number, number, number][] {
  const pieces: [number, number, number, number][] = [];
  if (!(on > 0)) return pieces;
  const period = on + Math.max(off, 0);
  const n = Math.floor(points.length / stride);
  let travelled = 0;
  for (let i = 1; i < n; i++) {
    const ax = points[(i - 1) * stride];
    const ay = points[(i - 1) * stride + 1];
    const dx = points[i * stride] - ax;
    const dy = points[i * stride + 1] - ay;
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
 * route's on the ground floor, so a dashed approach lies where the route
 * would. `stride` is 3 for a `PlannedPath`'s triples; the band stays flat at
 * `z` either way. With a `casing` hue each dash gets the route's rim, a
 * `casingWidth` wide each side.
 */
export function createDashedRibbon(
  points: Float32Array | readonly number[],
  color: number,
  {
    width = PATH_WIDTH_M,
    z = GROUND_FLOOR_Z_M + PATH_Z_M,
    opacity = 0.85,
    stride = 2,
    casing,
    casingWidth = PATH_CASING_M,
  }: {
    width?: number;
    z?: number;
    opacity?: number;
    stride?: number;
    casing?: number;
    casingWidth?: number;
  } = {},
): Ribbon | null {
  const pieces = dashPieces(points, DASH_ON_M, DASH_OFF_M, stride).filter(
    ([ax, ay, bx, by]) => Math.hypot(bx - ax, by - ay) > 0,
  );
  if (!pieces.length) return null;

  const band = (half: number, grow: number, h: number) => {
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [ax, ay, bx, by] of pieces) {
      const length = Math.hypot(bx - ax, by - ay);
      const tx = (bx - ax) / length;
      const ty = (by - ay) / length;
      // Left normal, as in createPathRibbon. A casing also runs `grow` past
      // each end, so a dash is rimmed all round rather than on its sides.
      const ox = -ty * half;
      const oy = tx * half;
      const sx = ax - tx * grow;
      const sy = ay - ty * grow;
      const ex = bx + tx * grow;
      const ey = by + ty * grow;
      const v = positions.length / 3;
      positions.push(
        sx + ox, sy + oy, h,
        sx - ox, sy - oy, h,
        ex + ox, ey + oy, h,
        ex - ox, ey - oy, h,
      );
      indices.push(v, v + 1, v + 3, v, v + 3, v + 2);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setIndex(indices);
    return geometry;
  };

  return stackRibbon(
    band(width / 2, 0, z),
    casing === undefined ? null : band(width / 2 + casingWidth, casingWidth, z - CASING_DROP_M),
    { color, opacity, casingColor: casing },
  );
}
