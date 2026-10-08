// Keys for the TanStack Query cache, centralised so cache *sharing* is a
// decision made in one visible place. The interesting entry is mapVertices:
// useMapVertices (the gridmap editor) and useActiveMapVertices (the dashboard
// and task screens) deliberately read the same key, which is what makes a
// vertex placed or moved on one screen already current on the other — with
// neither hook knowing the other exists. Keep any new key here rather than
// inline in its hook, or that property quietly stops being checkable.

import type { OctomapLayer } from "@/lib/types/map";

export const queryKeys = {
  /** GET /api/v1/robot/state — the console's single 1 Hz poll. */
  robotState: ["robot-state"] as const,
  /**
   * GET /api/v1/robot/restart — the latest restart and how it ended. Read once
   * on mount, so a restart started from another console shows too, and polled
   * only while it says `restarting`.
   */
  robotRestart: ["robot-restart"] as const,
  /**
   * GET /api/v1/mapping — where the mapping run stands (idle / mapping /
   * resetting / unknown, with the keyframe count). Polled at 1 Hz only on
   * /mapping and only while the robot reports Mapping: keyframes bank as the
   * robot drives, so the server changes it on its own; off everywhere else,
   * where the answer is `unknown` by construction. A start, save or reset
   * invalidates it rather than writing it — the answer travels a latched ROS
   * topic, so the poll is the one source every console agrees on.
   */
  mappingStatus: ["mapping-status"] as const,
  /** GET /api/v1/active_tasks — the console's single 2 s poll. */
  activeTasks: ["active-tasks"] as const,
  /**
   * GET /api/v1/tasks/<id> — one run's per-step readback.
   *
   * Keyed per task rather than per screen, and read by three surfaces on
   * purpose: useTaskTracker (1 Hz, a run this tab dispatched), the masthead's
   * useActiveRun (2 s, whatever the active list says is running — the only
   * place a paused run is visible, since `/active_tasks` lists it as
   * IN_PROGRESS) and useTaskRun (once, an expanded history row). Sharing the
   * entry is what gives the masthead the steps the tracker already fetched
   * for a run this tab started, and what opens a history row on the last
   * read the masthead made of a run that just finished. The two pollers each
   * tick their own timer and dedupe only when they overlap, so a run this tab
   * dispatched costs up to ~1.5 reads a second rather than one; any observer
   * must use `fetchHeldTaskState`, or its own tick can blank the others'
   * step list with a degraded `[]`.
   */
  task: (id: string) => ["task", id] as const,
  /**
   * GET /api/v1/task_history — the root every filtered history list *and* the
   * dashboard's counts sit under, so the one invalidation in useActiveTasks
   * refreshes whichever filter is on screen, list and numbers alike. Its own
   * root rather than `["task", …]`: a per-run readback must not be swept up
   * each time a run finishes, and history must not be swept up by the tracker.
   */
  taskHistory: ["task-history"] as const,
  /**
   * One page of one filtered history list, addressed by the cursor that
   * reaches it (null for the first). `filterKey` is historyQueryKey() of the
   * whole filter — outcome, window, kind, name — because the backend's token
   * is only valid under the exact filter it was issued with, so any change
   * has to start again from page one, and a new key does that. The window's
   * `since` is in it too, which is why useHistoryFilter anchors the window
   * once per gesture rather than on every render.
   */
  taskHistoryPage: (filterKey: string, pageToken: string | null) =>
    ["task-history", "page", filterKey, pageToken ?? "first"] as const,
  /**
   * GET /api/v1/task_history/stats under the same filter — the counts above
   * the list. Its own branch beside the pages, so turning a page never
   * re-counts and a re-count never re-reads a page; the literal segment is
   * what keeps the two families from ever sharing a key.
   */
  taskHistoryStats: (filterKey: string) =>
    ["task-history", "stats", filterKey] as const,
  /** GET /api/v1/maps — the catalogue, read by every screen that needs the active map. */
  maps: ["maps"] as const,
  /** GET /api/v1/maps/<name>/vertices — one map's stops, keyed by map name. */
  mapVertices: (name: string) => ["map-vertices", name] as const,
  /**
   * GET /api/v1/maps/<name>/keepout — one map's forbidden zones, as saved.
   *
   * Shared by the floor plan editor and the dashboard, the way `mapVertices`
   * is. The editor seeds its zone layer from it once and never while
   * editing: a refetch landing mid-edit must not put back zones the operator
   * just removed. A save or a Remove writes its answer here, so a reopened
   * editor, and the dashboard, start from what the robot holds.
   */
  mapKeepout: (name: string) => ["map-keepout", name] as const,
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
   * Keyed by name alone, unlike `mapImage`. The catalogue's only version is
   * `modified_at`, the newest file in the whole map directory, and a floor
   * plan convert or grid save moves it without touching `map.pcd`. Keying the
   * scan by it re-downloaded the scan after every floor plan rebuild. A name's
   * scan does not change in place: a save under a taken name is refused (see
   * `saveMap`), so the file under a name only changes by a delete and a new
   * save. This console's mapping save, rename and delete drop the entry. A
   * delete and re-save of the same name from another console, while this tab
   * still holds the old scan, is not seen until the entry is collected. Only a
   * scan version from the backend would close that.
   */
  mapPointCloud: (name: string) => ["map-point-cloud", name] as const,
  /**
   * GET /api/v1/maps/<name>/octomap/<layer>, decoded — the dashboard's "3D
   * map" layer, one entry per layer. Left without `layer`, the key is a
   * prefix matching both, which is how the write hooks drop a map's entries.
   *
   * Keyed by name alone for `mapPointCloud`'s reasons, plus one of its own:
   * the entry is only ever filled once the catalogue says the build is `ok`
   * (the hook is not enabled before), and a refused read is not cached, so a
   * 3D map that lands minutes after the save is picked up on the first press.
   * What it leaves open is the robot rebuilding the layers in place under a
   * name this tab already holds — not something the robot does on its own;
   * only the build's finish time in the key would close that.
   */
  mapOctomap: (name: string, layer?: OctomapLayer) =>
    layer === undefined
      ? (["map-octomap", name] as const)
      : (["map-octomap", name, layer] as const),
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
