// Links into the map screens, in one place so every caller agrees on the query
// the editors read (app/maps/[name]/edit/page.tsx, app/maps/[name]/3d/page.tsx).

import type { MapSummary } from "@/lib/types/map";

/** Where a link into a map screen came from, which its Back returns to. */
export type MapLinkFrom = "tasks";

/**
 * The 3D map and its ground editor (app/maps/[name]/3d/page.tsx), opened with
 * its Waypoint tool armed when `tool` asks for it.
 */
export function map3dHref(
  mapName: string,
  options: { tool?: "waypoint"; from?: MapLinkFrom } = {},
): string {
  const params = new URLSearchParams();
  if (options.tool) params.set("tool", options.tool);
  if (options.from) params.set("from", options.from);
  const query = params.toString();
  return `/maps/${encodeURIComponent(mapName)}/3d${query ? `?${query}` : ""}`;
}

/** The gridmap editor, opened in Waypoints mode, with a way back to `from`. */
export function waypointEditorHref(
  mapName: string,
  options: { from?: MapLinkFrom } = {},
): string {
  const params = new URLSearchParams({ mode: "vertex" });
  if (options.from) params.set("from", options.from);
  return `/maps/${encodeURIComponent(mapName)}/edit?${params.toString()}`;
}

/** The screen that places a map's waypoints, and what they are placed on. */
export interface WaypointEditor {
  /** The on-screen word for what the waypoints are placed on. */
  surface: "floor plan" | "3D map";
  href: string;
}

/**
 * Where a map's waypoints are placed: the floor plan editor when the map has
 * a floor plan, else the 3D map page once the robot has finished its 3D map,
 * else nowhere. The floor plan wins on a map with both because the task
 * editor previews a job's waypoints on it. A map saved as a scan and a 3D map
 * alone has no raster for the floor plan editor to open, which is what sent
 * its every waypoint link to a page that could not load.
 */
export function waypointEditor(
  map: Pick<MapSummary, "name" | "grid" | "octomap_status">,
  options: { from?: MapLinkFrom } = {},
): WaypointEditor | null {
  if (map.grid !== null) {
    return { surface: "floor plan", href: waypointEditorHref(map.name, options) };
  }
  if (map.octomap_status === "ok") {
    return {
      surface: "3D map",
      href: map3dHref(map.name, { tool: "waypoint", from: options.from }),
    };
  }
  return null;
}
