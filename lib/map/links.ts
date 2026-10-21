// Links into the map editor, in one place so every caller agrees on the query
// the editor reads (app/maps/[name]/edit/page.tsx).

import type { MapSummary } from "@/lib/types/map";

/** Where a link into a map screen came from, which its Back returns to. */
export type MapLinkFrom = "tasks";

/** The editor's two views: the floor plan, and the 3D map with its waypoints. */
export type MapEditorView = "2d" | "3d";

function editorHref(mapName: string, params: Record<string, string | undefined>): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.set(key, value);
  }
  const search = query.toString();
  return `/maps/${encodeURIComponent(mapName)}/edit${search ? `?${search}` : ""}`;
}

/**
 * The editor's 3D view, opened with its Waypoint tool armed when `tool`
 * asks for it.
 */
export function map3dHref(
  mapName: string,
  options: { tool?: "waypoint"; from?: MapLinkFrom } = {},
): string {
  return editorHref(mapName, { view: "3d", tool: options.tool, from: options.from });
}

/** The editor's floor plan view, opened in Waypoints mode, with a way back to `from`. */
export function waypointEditorHref(
  mapName: string,
  options: { from?: MapLinkFrom } = {},
): string {
  return editorHref(mapName, { mode: "vertex", from: options.from });
}

/**
 * The editor in one view, as it opens with nothing armed. The floor plan
 * view is the bare path, as it was before the editor had a second view.
 */
export function mapEditorHref(
  mapName: string,
  view: MapEditorView,
  options: { from?: MapLinkFrom } = {},
): string {
  return view === "3d"
    ? map3dHref(mapName, options)
    : editorHref(mapName, { from: options.from });
}

/**
 * The views a map's editor offers, the one its pencil opens first: the
 * floor plan when there is one (the task editor previews a job on it), and
 * the 3D map once the robot has finished it. A floor plan mid-conversion is not
 * offered — cells saved now would land on a grid about to be replaced — but
 * a *failed* re-conversion is, since it serves the archived grid. Empty for
 * a map with neither, which has nothing to edit yet.
 */
export function editorViews(
  map: Pick<MapSummary, "grid" | "grid_status" | "octomap_status">,
): MapEditorView[] {
  const views: MapEditorView[] = [];
  if (map.grid !== null && map.grid_status !== "converting") views.push("2d");
  if (map.octomap_status === "ok") views.push("3d");
  return views;
}

/** The screen that places a map's waypoints, and what they are placed on. */
export interface WaypointEditor {
  /** The on-screen word for what the waypoints are placed on. */
  surface: "floor plan" | "3D map";
  href: string;
}

/**
 * Where a map's waypoints are placed: the floor plan view when the map has
 * a floor plan, else the 3D view once the robot has finished its 3D map,
 * else nowhere. The floor plan wins on a map with both because the task
 * editor previews a job's waypoints on it. A map saved as a scan and a 3D map
 * alone has no raster for the floor plan view to open, which is what sent
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
