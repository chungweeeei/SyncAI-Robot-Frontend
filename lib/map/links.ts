// Links into the map screens, in one place so every caller agrees on the query
// the editor reads (app/maps/[name]/edit/page.tsx).


/** The 3D map and its ground editor (app/maps/[name]/3d/page.tsx). */
export function map3dHref(mapName: string): string {
  return `/maps/${encodeURIComponent(mapName)}/3d`;
}

/** The gridmap editor, opened in Waypoints mode, with a way back to `from`. */
export function waypointEditorHref(
  mapName: string,
  options: { from?: "tasks" } = {},
): string {
  const params = new URLSearchParams({ mode: "vertex" });
  if (options.from) params.set("from", options.from);
  return `/maps/${encodeURIComponent(mapName)}/edit?${params.toString()}`;
}
