import * as THREE from "three";

import { MAP_POINT_SIZE } from "@/lib/scene/live-cloud";
import type { Theme } from "@/lib/scene/theme";
import type { PointCloudFrame } from "@/lib/types/pointcloud";

/**
 * The two map clouds a mapping run streams: what the run has built (`run`),
 * and on a resumed run the saved map it continues (`saved`), which the robot
 * hands off apart so the two can be told apart on screen — what the run has
 * added, and a resume that landed off the saved map, which shows as a wall
 * drawn twice in two colours.
 */
export type StreamedMapLayer = "run" | "saved";

/**
 * How each layer is drawn. Both dim and solid, so the height-coloured live
 * scan reads on top. Read by the legend too, so its swatches are these marks.
 */
export const STREAMED_MAP_STYLE: Record<
  StreamedMapLayer,
  { color: (theme: Theme) => number; opacity: number; renderOrder: number }
> = {
  run: { color: (theme) => theme.mapCloud, opacity: 0.6, renderOrder: 0 },
  // Drawn first and writing no depth: where a run point stands beside the
  // saved map, it is the one seen, not whichever of two near-coincident
  // points the depth test happens to keep.
  saved: { color: (theme) => theme.savedMapCloud, opacity: 0.6, renderOrder: -1 },
};

/**
 * One frame as a points layer. Zero-copy: each WebSocket message owns its
 * ArrayBuffer, and the layer is replaced (never appended to) by the next
 * frame, since a loop closure moves the whole map.
 */
export function createStreamedMapLayer(
  frame: PointCloudFrame,
  layer: StreamedMapLayer,
  theme: Theme,
): THREE.Points {
  const style = STREAMED_MAP_STYLE[layer];
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.BufferAttribute(frame.positions, 3));
  const points = new THREE.Points(
    geom,
    new THREE.PointsMaterial({
      size: MAP_POINT_SIZE,
      color: style.color(theme),
      opacity: style.opacity,
      transparent: true,
      depthWrite: layer === "run",
    }),
  );
  points.renderOrder = style.renderOrder;
  points.frustumCulled = false;
  return points;
}

/** Take a layer out of its scene and free it; the next frame builds a new one. */
export function disposeStreamedMapLayer(scene: THREE.Scene, points: THREE.Points): void {
  scene.remove(points);
  points.geometry.dispose();
  (points.material as THREE.Material).dispose();
}

/**
 * The cell a run point is judged by: two of the robot's 0.2 m map voxels, so
 * a wall re-scanned a voxel off its saved twin still counts as the same wall,
 * while one a resume put half a metre off does not — the misplacement the
 * two colours are there to show.
 */
export const SAVED_MAP_CELL_M = 0.4;

// Cell indices packed into one integer, exact in a double: x and y within
// ±20 km of the origin, z within ±2 km — beyond any site a robot maps.
const XY_SPAN = 100_000;
const Z_SPAN = 10_000;

function cellKey(x: number, y: number, z: number): number {
  const ix = Math.floor(x / SAVED_MAP_CELL_M) + XY_SPAN / 2;
  const iy = Math.floor(y / SAVED_MAP_CELL_M) + XY_SPAN / 2;
  const iz = Math.floor(z / SAVED_MAP_CELL_M) + Z_SPAN / 2;
  return ix + XY_SPAN * (iy + XY_SPAN * iz);
}

/** The cells the saved map occupies, built once per saved frame (one a run). */
export function savedMapCells(frame: PointCloudFrame): Set<number> {
  const cells = new Set<number>();
  const p = frame.positions;
  for (let i = 0; i < frame.count; i++) {
    cells.add(cellKey(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
  }
  return cells;
}

/**
 * The run's points the saved map does not already have. A resumed run
 * re-scans much of the map it continues, and drawn whole it buries the saved
 * map under its own colour, so neither "what was there" nor "what this run
 * added" can be read off the screen. A copy, not a view: the frame keeps its
 * buffer for the next re-apply.
 */
export function pointsOffSavedMap(frame: PointCloudFrame, cells: Set<number>): PointCloudFrame {
  const src = frame.positions;
  const kept = new Float32Array(frame.count * 3);
  let n = 0;
  for (let i = 0; i < frame.count; i++) {
    const x = src[i * 3];
    const y = src[i * 3 + 1];
    const z = src[i * 3 + 2];
    if (cells.has(cellKey(x, y, z))) continue;
    kept[n * 3] = x;
    kept[n * 3 + 1] = y;
    kept[n * 3 + 2] = z;
    n++;
  }
  return { count: n, positions: kept.subarray(0, n * 3) };
}
