import type { MapSummary } from "@/lib/types/map";

export const SWITCH_NO_SCAN =
  "This map has no scan data, so the robot could not work out where it is. Only a map made by a mapping run can be used.";
export const SWITCH_BUILDING_3D =
  "The robot is still building this map's 3D map. Wait for it to finish.";
export const SWITCH_NO_MAP =
  "This map has no 3D map, and the robot cannot navigate without one.";

/**
 * Why the robot cannot be switched onto a map, or null when it can. Mirrors
 * the backend's own refusals on `POST /maps/{name}/activate` so the card greys
 * the switch first; the backend is still the gate.
 *
 * The robot navigates on 3D maps only, so a map is usable once its 3D map is
 * built: `octomap_status === "ok"` is exactly the backend's test (the tree is
 * on disk, else 409 `octomap_missing`), so the two cannot drift apart.
 */
export function switchRefusal(
  map: Pick<MapSummary, "has_pointcloud" | "octomap_status">,
): string | null {
  if (!map.has_pointcloud) return SWITCH_NO_SCAN;
  if (map.octomap_status === "ok") return null;
  if (map.octomap_status === "converting") return SWITCH_BUILDING_3D;
  return SWITCH_NO_MAP;
}
