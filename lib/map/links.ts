// Links into the map editor, in one place so every caller agrees on the query
// the editor reads (app/maps/[name]/edit/page.tsx).

import type { MapSummary } from "@/lib/types/map";

/** Where a link into a map screen came from, which its Back returns to. */
export type MapLinkFrom = "tasks";

/**
 * The map's editor — its 3D map, with the waypoints, zones and ground
 * patches on it — opened with its Waypoint tool armed when `tool` asks for
 * it, and with a way back to `from`.
 */
export function mapEditorHref(
  mapName: string,
  options: { tool?: "waypoint"; from?: MapLinkFrom } = {},
): string {
  const query = new URLSearchParams();
  if (options.tool) query.set("tool", options.tool);
  if (options.from) query.set("from", options.from);
  const search = query.toString();
  return `/maps/${encodeURIComponent(mapName)}/edit${search ? `?${search}` : ""}`;
}

/**
 * Whether a map has anything for the editor to open: a 3D map the robot has
 * finished. Building, failed or never made has nothing to place a waypoint
 * on, and the Maps screen is where those states are said.
 */
export function canEditMap(map: Pick<MapSummary, "octomap_status">): boolean {
  return map.octomap_status === "ok";
}

/** The screen that places a map's waypoints. */
export interface WaypointEditor {
  href: string;
}

/**
 * Where a map's waypoints are placed: the editor with Waypoint armed, once
 * the robot has finished the map's 3D map, else nowhere.
 */
export function waypointEditor(
  map: Pick<MapSummary, "name" | "octomap_status">,
  options: { from?: MapLinkFrom } = {},
): WaypointEditor | null {
  if (!canEditMap(map)) return null;
  return { href: mapEditorHref(map.name, { tool: "waypoint", from: options.from }) };
}
