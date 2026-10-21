import type { MapSummary } from "@/lib/types/map";

export const SWITCH_CONVERTING =
  "This map is still being prepared. Wait for it to finish.";
export const SWITCH_NO_SCAN =
  "This map has no scan data, so the robot could not work out where it is. Only a map made by a mapping run can be used.";
export const SWITCH_BUILDING_3D =
  "The robot is still building this map's 3D map. Wait for it to finish.";
export const SWITCH_NO_MAP =
  "This map has no floor plan and no 3D map yet, and the robot cannot navigate without one of them. Build the floor plan first.";

/**
 * Why the robot cannot be switched onto a map, or null when it can. Mirrors
 * the backend's own refusals on `POST /maps/{name}/activate` so the card greys
 * the switch first; the backend is still the gate.
 *
 * A map is navigable with a floor plan *or* a 3D map: the robot plans on its
 * 3D map whenever the map has one, and on the floor plan otherwise. A
 * floor-plan-only rule here held back every map saved with a 3D map and no
 * floor plan, which the backend switches to. `octomap_status === "ok"` is
 * exactly the backend's test (the tree is on disk), so the two cannot drift
 * apart on what counts as 3D.
 */
export function switchRefusal(
  map: Pick<MapSummary, "grid_status" | "has_pointcloud" | "octomap_status">,
): string | null {
  // Refused whatever else the map has: the conversion rewrites the floor plan
  // the switch would hand the robot.
  if (map.grid_status === "converting") return SWITCH_CONVERTING;
  if (!map.has_pointcloud) return SWITCH_NO_SCAN;
  if (map.grid_status === "ok" || map.octomap_status === "ok") return null;
  if (map.octomap_status === "converting") return SWITCH_BUILDING_3D;
  return SWITCH_NO_MAP;
}
