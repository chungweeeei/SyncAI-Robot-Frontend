// Keys for the TanStack Query cache, centralised so cache *sharing* is a
// decision made in one visible place. The interesting entry is mapVertices:
// useMapVertices (the gridmap editor) and useActiveMapVertices (the dashboard
// and task screens) deliberately read the same key, which is what makes a
// vertex placed or moved on one screen already current on the other — with
// neither hook knowing the other exists. Keep any new key here rather than
// inline in its hook, or that property quietly stops being checkable.

export const queryKeys = {
  /** GET /api/v1/robot/state — the console's single 1 Hz poll. */
  robotState: ["robot-state"] as const,
  /** GET /api/v1/active_tasks — the console's single 2 s poll. */
  activeTasks: ["active-tasks"] as const,
  /**
   * GET /api/v1/tasks/<id> — one dispatched run's per-step readback, polled at
   * 1 Hz while it is still going.
   *
   * Keyed per task rather than per screen, which is what stops two surfaces
   * following the same run from opening two intervals, and what makes the
   * entry go away with the run it describes.
   */
  task: (id: string) => ["task", id] as const,
  /**
   * GET /api/v1/task_history — the root every filtered history list sits
   * under, so one invalidation refreshes whichever filter is on screen. Its own
   * root rather than `["task", …]`: a per-run readback must not be swept up
   * each time a run finishes, and history must not be swept up by the tracker.
   */
  taskHistory: ["task-history"] as const,
  /**
   * One page of one filtered history list, addressed by the cursor that
   * reaches it (null for the first). The status is part of the key because the
   * backend's token is only valid under the filter it was issued with, so a
   * filter change has to start again from page one — a new key does that.
   */
  taskHistoryPage: (status: string | null, pageToken: string | null) =>
    ["task-history", status ?? "all", pageToken ?? "first"] as const,
  /** GET /api/v1/maps — the catalogue, read by every screen that needs the active map. */
  maps: ["maps"] as const,
  /** GET /api/v1/maps/<name>/vertices — one map's stops, keyed by map name. */
  mapVertices: (name: string) => ["map-vertices", name] as const,
  /**
   * GET /api/v1/maps/<name>/image, decoded for drawing — the floor plan under
   * the task editor's waypoint preview. One entry per map version, shared by
   * every expanded MOVE row, so ten open rows cost one request and one decode.
   *
   * `version` is what the catalogue says about the files (see useMapImage),
   * which is what retires a raster rewritten by another console, the MCP
   * server or a conversion this tab never saw. It used to be keyed by name
   * alone and never go stale, which was only true of writes this console
   * made. Left out, the key is a prefix matching every version: the write
   * hooks drop a map's entries that way.
   */
  mapImage: (name: string, version?: string) =>
    version === undefined
      ? (["map-image", name] as const)
      : (["map-image", name, version] as const),
  /**
   * GET /api/v1/maps/<name>/pointcloud, decoded — the dashboard's "Map scan"
   * layer. Cached so turning the layer off and on again does not repeat a
   * 100k+ point download for a file that has not changed.
   *
   * Versioned like `mapImage`, for the same reason: a mapping save from
   * another console rewrites the file without this tab's write hooks ever
   * running. Left out, the key is a prefix; a mapping save, rename or delete
   * here drops every version. A convert or a grid save leaves the scan alone.
   */
  mapPointCloud: (name: string, version?: string) =>
    version === undefined
      ? (["map-point-cloud", name] as const)
      : (["map-point-cloud", name, version] as const),
  /** GET /api/v1/task_templates — the operator's template library. */
  taskTemplates: ["task-templates"] as const,
  /** GET /api/v1/schedules — Temporal's schedule list. */
  schedules: ["schedules"] as const,
  /**
   * GET /api/v1/schedules/<id> — one schedule *with* its frozen steps, which
   * the list cannot carry (see lib/api/schedule.ts). Its own root rather than
   * `["schedules", id]` on purpose: invalidating the list after a pause or
   * delete must not also re-describe every expanded row.
   */
  schedule: (id: string) => ["schedule", id] as const,
  /**
   * GET /api/v1/recordings — the bag catalogue. Shared by the list and by the
   * recorder panel's "did the bag I just stopped come out playable" read, so
   * stopping a recording updates both from one request.
   */
  recordings: ["recordings"] as const,
  /**
   * GET /api/v1/recordings/active — the live recorder, polled on its own.
   *
   * Deliberately NOT folded into `recordings`: it is the 1 Hz tick behind the
   * elapsed readout, and the catalogue it would drag along walks every bag
   * directory on the robot to answer.
   */
  activeRecording: ["active-recording"] as const,
  /**
   * GET /api/v1/network/wifi/scan — a ~45 s nmcli rescan on the robot. Fetched
   * once per Settings visit and on an explicit Rescan only; see useWifiScan for
   * why it is never refetched on its own.
   */
  wifiScan: ["wifi-scan"] as const,
};
