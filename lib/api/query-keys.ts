// Every TanStack Query key, so cache *sharing* is decided in one visible place
// (e.g. mapVertices, read by both the floor plan editor and the dashboard).
// Never inline a key in its hook.

export const queryKeys = {
  /** GET /api/v1/robot/state — the console's single 1 Hz poll. */
  robotState: ["robot-state"] as const,
  /**
   * GET /api/v1/robot/restart — the latest restart. Read on mount (so another
   * console's restart shows) and polled only while `restarting`.
   */
  robotRestart: ["robot-restart"] as const,
  /**
   * GET /api/v1/mapping — the mapping run's state. Polled at 1 Hz only on
   * /mapping while the robot reports Mapping, the only time it changes on its
   * own. Writes invalidate rather than write it: the answer is a latched topic
   * every console reads alike.
   */
  mappingStatus: ["mapping-status"] as const,
  /** GET /api/v1/active_tasks — the console's single 2 s poll. */
  activeTasks: ["active-tasks"] as const,
  /**
   * GET /api/v1/tasks/<id> — one run's per-step readback, shared on purpose by
   * useTaskTracker (1 Hz, a run this tab dispatched), the masthead's
   * useActiveRun (2 s; the only place a paused run is visible, since
   * `/active_tasks` lists it as IN_PROGRESS) and useTaskRun (once, a history
   * row). Every observer must use `fetchHeldTaskState`, or its own tick can
   * blank the others' step list with a degraded `[]`.
   */
  task: (id: string) => ["task", id] as const,
  /**
   * GET /api/v1/task_history — the root of every history page *and* count, so
   * useActiveTasks' one invalidation refreshes both. Not under `["task", …]`,
   * so neither family sweeps up the other.
   */
  taskHistory: ["task-history"] as const,
  /**
   * One history page by its cursor (null for the first). `filterKey` is the
   * whole filter: the backend's token is valid only under the filter it was
   * issued with. It includes `since`, which is why useHistoryFilter anchors
   * the window once per gesture.
   */
  taskHistoryPage: (filterKey: string, pageToken: string | null) =>
    ["task-history", "page", filterKey, pageToken ?? "first"] as const,
  /**
   * GET /api/v1/task_history/stats under the same filter. Its own branch, so
   * turning a page never re-counts.
   */
  taskHistoryStats: (filterKey: string) =>
    ["task-history", "stats", filterKey] as const,
  /** GET /api/v1/maps — the catalogue. */
  maps: ["maps"] as const,
  /** GET /api/v1/maps/<name>/vertices — shared by the editor and the dashboard. */
  mapVertices: (name: string) => ["map-vertices", name] as const,
  /**
   * GET /api/v1/maps/<name>/keepout — forbidden zones, shared like
   * `mapVertices`. The editor seeds from it once, never mid-edit, so a refetch
   * cannot restore a zone just removed; a save writes its answer here.
   */
  mapKeepout: (name: string) => ["map-keepout", name] as const,
  /**
   * GET /api/v1/maps/<name>/image, decoded — the task editor's floor plan,
   * one entry per map version shared by every open MOVE row.
   *
   * `version` comes from the catalogue (see useMapImage), so a raster
   * rewritten elsewhere is retired too. Without it the key is a prefix over
   * every version, which is how the write hooks drop a map's entries.
   */
  mapImage: (name: string, version?: string) =>
    version === undefined
      ? (["map-image", name] as const)
      : (["map-image", name, version] as const),
  /**
   * GET /api/v1/maps/<name>/pointcloud, decoded — the dashboard's "Map scan".
   *
   * Keyed by name alone, unlike `mapImage`: `modified_at` covers the whole
   * map directory, so a floor plan rebuild would re-download an unchanged
   * scan. A name's scan only changes by delete and re-save (a taken name is
   * refused), which this console's writes drop. The open case: another
   * console deleting and re-saving the name; only a backend scan version
   * would close it.
   */
  mapPointCloud: (name: string) => ["map-point-cloud", name] as const,
  /**
   * GET /api/v1/maps/<name>/octomap, decoded — the dashboard's "3D map" and
   * the 3D view's, one entry shared by both.
   *
   * Keyed like `mapImage`, by a version the catalogue reports
   * (`octomap_version`, see useMapOctomap): unlike the scan, the tree is
   * replaced in place — by a re-clean, or by the robot's edit tool applying
   * the ground patches — and `modified_at` cannot say which file moved.
   * Without the version it is the prefix the write hooks drop a map's
   * entries by.
   */
  mapOctomap: (name: string, version?: string) =>
    version === undefined
      ? (["map-octomap", name] as const)
      : (["map-octomap", name, version] as const),
  /**
   * The Maps card's still of the 3D map (lib/scene/voxel-snapshot.ts), drawn
   * from the `mapOctomap` entry and the map's floors. Keyed by the tree's
   * version and the floor levels it was cut at, so a re-clean or a floors
   * save draws a new one; without them it is the prefix the write hooks drop
   * a map's stills by.
   */
  mapOctomapPreview: (name: string, version?: string, levels?: string) =>
    version === undefined
      ? (["map-octomap-preview", name] as const)
      : (["map-octomap-preview", name, version, levels ?? ""] as const),
  /**
   * GET /api/v1/maps/<name>/octomap/edits — the ground patches saved for the
   * 3D map. Like `mapKeepout`: the editor seeds from it once and a save
   * writes its answer here, since a save is the whole list.
   */
  mapOctomapEdits: (name: string) => ["map-octomap-edits", name] as const,
  /**
   * GET /api/v1/maps/<name>/floors — the storeys a map spans, which the
   * dashboard's 3D map and the editor's 3D view both pick a band from, so a
   * rename on one is the other's list too. A save writes its answer here; a
   * mapping save into the name drops it, since the detection reads the new
   * walk.
   */
  mapFloors: (name: string) => ["map-floors", name] as const,
  /**
   * GET /api/v1/task_steps — the steps the robot can take, which the task
   * editor builds its menus and forms from. Nothing this console does changes
   * it, so nothing invalidates it; it is read once a session.
   */
  taskSteps: ["task-steps"] as const,
  /** GET /api/v1/task_templates — the operator's template library. */
  taskTemplates: ["task-templates"] as const,
  /** GET /api/v1/schedules */
  schedules: ["schedules"] as const,
  /**
   * GET /api/v1/schedules/<id> — one schedule with its frozen steps. Not under
   * `["schedules", …]`, so invalidating the list does not re-read every row.
   */
  schedule: (id: string) => ["schedule", id] as const,
  /** GET /api/v1/recordings — shared by the list and the recorder panel. */
  recordings: ["recordings"] as const,
  /**
   * GET /api/v1/recordings/active — polled at 1 Hz on its own, NOT folded into
   * `recordings`, whose answer walks every recording on the robot.
   */
  activeRecording: ["active-recording"] as const,
  /** GET /api/v1/network/wifi/scan — slow; never refetched on its own (see useWifiScan). */
  wifiScan: ["wifi-scan"] as const,
  /**
   * GET /api/v1/network/wifi/connections — not polled: only this console's
   * writes change it. (`active` moves on a roam too, so the live network is
   * read from the state poll.)
   */
  wifiConnections: ["wifi-connections"] as const,
};

/**
 * Every key that belongs to one map, each by its name-only prefix so a
 * versioned entry goes with it. A rename or delete drops them all: they
 * will never be read under that name again, and one left behind would be
 * served to a new map that takes the name. A key added above that takes a
 * map name belongs here too; query-keys.test.ts holds the list to that.
 */
export function mapScopedKeys(name: string): readonly (readonly unknown[])[] {
  return [
    queryKeys.mapVertices(name),
    queryKeys.mapKeepout(name),
    queryKeys.mapImage(name),
    queryKeys.mapPointCloud(name),
    queryKeys.mapOctomap(name),
    queryKeys.mapOctomapPreview(name),
    queryKeys.mapOctomapEdits(name),
    queryKeys.mapFloors(name),
  ];
}

/**
 * Mutation keys: the few writes another part of the console has to see in
 * flight (`useIsMutating`), kept beside the query keys for the same reason —
 * the sharing is decided here, not inlined in each hook.
 */
export const mutationKeys = {
  /**
   * A Wi-Fi join (by SSID or a saved network) or forget. The robot runs one
   * at a time and refuses the rest (409 `wifi_busy`), so every such button
   * greys while any of them is in flight from this console.
   */
  wifiChange: ["wifi-change"] as const,
};
