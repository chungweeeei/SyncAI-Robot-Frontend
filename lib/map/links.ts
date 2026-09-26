// Where the map screens live, for the links other screens make into them.
//
// One place rather than a template string per call site: the task editor
// links into the gridmap editor from two spots, and both have to agree on the
// query the editor reads (see app/maps/[name]/edit/page.tsx).

/** The gridmap editor, opened in Waypoints mode, with a way back to `from`. */
export function waypointEditorHref(
  mapName: string,
  options: { from?: "tasks" } = {},
): string {
  const params = new URLSearchParams({ mode: "vertex" });
  if (options.from) params.set("from", options.from);
  return `/maps/${encodeURIComponent(mapName)}/edit?${params.toString()}`;
}
