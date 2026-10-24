// The task editor's waypoints over the 3D map, as screen marks: where each
// stop lands on screen through the camera, and which one a pointer is on.
// Screen-sized rather than metre-sized, because a 0.3 m pin over a 100 m
// building is two pixels, which nobody can find or tap.

import * as THREE from "three";

import { drawnGround } from "@/lib/map/floors";
import type { PlacedStop } from "@/lib/map/preview";
import type { MapVertex } from "@/lib/types/map";

/** The point of a stop that is projected: just over its ground, level with the route's legs. */
const MARK_LIFT_M = 0.08;
/** How far along its heading the second point is taken, for the arrow's screen angle. */
const HEADING_PROBE_M = 0.5;

const AT = new THREE.Vector3();
const AHEAD = new THREE.Vector3();

/**
 * Each shown stop's screen position in a `width` × `height` view, CSS px,
 * and its heading as the screen shows it. A stop on another floor than the
 * band (by its ground height, as the vertex layer's setBand) or behind the
 * camera is left out, so it is neither drawn nor tappable.
 */
export function projectStops(
  camera: THREE.Camera,
  vertices: readonly MapVertex[],
  band: { lo: number; hi: number } | null,
  width: number,
  height: number,
): Map<string, PlacedStop> {
  camera.updateMatrixWorld();
  const placed = new Map<string, PlacedStop>();
  for (const vertex of vertices) {
    if (band && (vertex.z < band.lo || vertex.z >= band.hi)) continue;
    const z = drawnGround(vertex.z) + MARK_LIFT_M;
    AT.set(vertex.x, vertex.y, z).project(camera);
    // Outside the depth range is behind the camera or past its far plane.
    if (AT.z < -1 || AT.z > 1) continue;
    const radians = (vertex.theta * Math.PI) / 180;
    AHEAD.set(
      vertex.x + Math.cos(radians) * HEADING_PROBE_M,
      vertex.y + Math.sin(radians) * HEADING_PROBE_M,
      z,
    ).project(camera);
    const cx = ((AT.x + 1) / 2) * width;
    const cy = ((1 - AT.y) / 2) * height;
    const ax = ((AHEAD.x + 1) / 2) * width;
    const ay = ((1 - AHEAD.y) / 2) * height;
    // Screen y grows down; drawMarker's theta is CCW with y up.
    const theta = (Math.atan2(cy - ay, ax - cx) * 180) / Math.PI;
    placed.set(vertex.id, { cx, cy, theta });
  }
  return placed;
}

/**
 * The stop nearest a screen point within `radius` px, or null. Nearest
 * rather than last drawn: from an oblique view two stops can sit a few px
 * apart, and the one the pointer is closer to is the one meant.
 */
export function stopNear(
  placed: ReadonlyMap<string, PlacedStop>,
  vertices: readonly MapVertex[],
  cx: number,
  cy: number,
  radius: number,
): MapVertex | null {
  let best: MapVertex | null = null;
  let bestDistance = radius;
  for (const vertex of vertices) {
    const at = placed.get(vertex.id);
    if (!at) continue;
    const distance = Math.hypot(at.cx - cx, at.cy - cy);
    if (distance <= bestDistance) {
      best = vertex;
      bestDistance = distance;
    }
  }
  return best;
}
