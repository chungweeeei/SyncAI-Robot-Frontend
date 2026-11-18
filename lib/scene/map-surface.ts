// Where a mark stands over the 3D map: on the floor's top face, clear of the
// cells drawn round it, rather than at the z its waypoint was written with.

/**
 * The top face of the 3D map's surface under a map-frame point nearest a
 * height, metres, searched `reach` either side; null with no tree or no
 * surface in reach. What the canvas holding the tree hands a layer, as it
 * hands the costmap its ground.
 */
export type SurfaceTop = (wx: number, wy: number, z: number, reach: number) => number | null;

/**
 * How far from a mark's ground it looks for the floor's top face to stand
 * on, metres. That ground is a waypoint's z, a cell's centre on its floor,
 * read where the waypoint was put: half a cell under the top face at best,
 * and a cell lower again where that column reaches below the floor around it
 * (a charger's foot against the wall) — dp's 2F 2026-11-17, 5.15 m against a
 * 5.30 m top, which buried the charger's plate. Three cells of a 0.1 m tree,
 * and short of the next floor or a table top.
 */
export const MAP_SURFACE_REACH_M = 0.3;

/**
 * How far over the floor's top face a mark stands on the 3D map, metres:
 * half a 0.1 m cell. The map draws a cell as a camera-facing square of one
 * cell around its centre (Points), not as a cube, so seen from above at an
 * angle the cells in front reach about half a cell over the top face, and
 * nearer the eye; on the face itself the charger's 0.03 m plate was hidden
 * whole (dp's 2F, 2026-11-17). Seen nearly level, it leaves a gap of that
 * much under the mark.
 */
export const OVER_MAP_LIFT_M = 0.05;

/**
 * The height a mark at a map-frame point stands at: over the 3D map's floor
 * nearest `ground`, else `ground` itself. The caller picks the point, since
 * what has to clear the cells is not always over the waypoint (a charger's
 * plate is out in front of its marker, a staging point further out still).
 */
export function standsOnMap(
  wx: number,
  wy: number,
  ground: number,
  surfaceTop: SurfaceTop | null,
): number {
  const floorTop = surfaceTop?.(wx, wy, ground, MAP_SURFACE_REACH_M);
  // No tree drawn, or no floor in reach: no cells to clear.
  if (floorTop === null || floorTop === undefined) return ground;
  return floorTop + OVER_MAP_LIFT_M;
}
