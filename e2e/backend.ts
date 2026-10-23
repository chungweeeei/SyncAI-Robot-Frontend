import { deflateSync } from "node:zlib";

import type { Page, Route } from "@playwright/test";

import { encodeOctomapBt } from "@/lib/map/octree";
import { OCTREE_KEY_ORIGIN } from "@/lib/types/octree";

/**
 * A fake `syncai_backend`, installed per test. Routes match on path and ignore
 * the host, so a test need not know which port the client resolved.
 *
 * Fixtures are written from the interfaces in `lib/api/*` and `lib/types/*`,
 * which the zod schemas mirror: a drifted fixture fails loudly at the schema
 * rather than passing quietly.
 */

export const MAP_NAME = "dp2f";

/**
 * A 3D map the size of a doormat: a `size`×`size` floor one cell thick,
 * half a metre under the origin like the robot's own floor, with one 2×2
 * hole in the middle (cells `size/2 - 1` and `size/2` on both axes). Enough
 * for the dashboard to draw and for the editor's 3D view to have a hole to
 * patch. Built by the console's own encoder, which the decoder's unit tests
 * pin, so the fake and the client agree on the bit order. The 4×4 default
 * puts a hole cell under a click wherever the editor is; a phone test that
 * pinches hands in a larger one, since the editor's zoom tops out at 32 px
 * a cell and four cells already fill a phone past that.
 */
export function octomapBt(size = 4): Buffer {
  const O = OCTREE_KEY_ORIGIN;
  const lo = size / 2 - 1;
  const occupied: Array<[number, number, number]> = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const hole = x >= lo && x <= lo + 1 && y >= lo && y <= lo + 1;
      if (!hole) occupied.push([O + x, O + y, O - 5]);
    }
  }
  return Buffer.from(encodeOctomapBt({ res: 0.1, occupied }));
}

/** A 1x1 transparent PNG, so an <img> and a TextureLoader both succeed. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A floor plan the editor can paint on: an 8-bit greyscale PNG of
 * `width` x `height` cells, every one `byte` (254 free, 0 obstacle, 205
 * unknown — see classify in lib/map/grid.ts).
 *
 * The editor reads the image *as the grid*, so the 1x1 default is one cell
 * fitted to the canvas, and any zoom shrinks it out from under the pointer.
 * Hand this to `gridImage` in a test that strokes or pinches after zooming.
 */
export function floorPlanPng(
  width: number,
  height: number,
  byte: number,
): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 0; // greyscale
  // Each scanline is a filter byte (0: none) followed by the row.
  const raw = Buffer.alloc((width + 1) * height, byte);
  for (let y = 0; y < height; y += 1) raw[y * (width + 1)] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function robotState(over: Record<string, unknown> = {}) {
  return {
    timestamp: 1_758_000_000,
    robot_id: "robot01",
    map: `map/${MAP_NAME}/gridmap.yaml`,
    mode: "AUTO",
    low_level_mode: { policy: "PPO", motion: "LOCOMOTION", safety_locked: false },
    localization_valid: true,
    localization_status: {
      position: { x: 1.25, y: -3.5, z: 0, theta: 90 },
      velocity: 0.31,
    },
    network_status: {
      ssid: "site-wifi",
      bssid: "aa:bb:cc:dd:ee:ff",
      rssi: -52,
      ip_address: "10.8.140.138",
      mac_address: "11:22:33:44:55:66",
    },
    battery_status: { battery_percentage: 88 },
    motor_status: [
      { name: "FL_Knee_joint", temperature: 41, error: 0 },
      { name: "FR_Knee_joint", temperature: 43, error: 0 },
    ],
    ...over,
  };
}

export function mapSummary(over: Record<string, unknown> = {}) {
  return {
    name: MAP_NAME,
    active: true,
    grid: {
      resolution: 0.05,
      origin: { x: -12.3, y: -7.8, yaw: 0 },
      width: 400,
      height: 300,
    },
    thumbnail: `/api/v1/maps/${MAP_NAME}/thumbnail`,
    has_pointcloud: true,
    grid_status: "ok",
    grid_error: null,
    grid_converting: false,
    size_bytes: 24_117_248,
    modified_at: "2026-09-18T09:22:41Z",
    vertex_count: 2,
    // No 3D map unless a test says so: the robot builds one only when asked.
    // Typed loosely so a test can move the version under a mounted page.
    octomap_status: "none" as string,
    octomap_error: null as string | null,
    octomap_version: null as string | null,
    octomap_resolution: null as number | null,
    ...over,
  };
}

/** The 3D map fields of a map whose tree is on disk, for `mapSummary(over)`. */
export function withOctomap(version = "2971216-1760414598000000000") {
  return {
    octomap_status: "ok",
    octomap_error: null,
    octomap_version: version,
    octomap_resolution: 0.1,
  };
}

export function vertex(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "dock",
    type: "CHARGE",
    map_name: MAP_NAME,
    x: 2.5,
    y: 1.25,
    theta: 90,
    ...over,
  };
}

export function recording(over: Record<string, unknown> = {}) {
  return {
    name: "rec_20260918T0922Z",
    status: "ok",
    size_bytes: 1_073_741_824,
    modified_at: "2026-09-18T09:40:00Z",
    duration_seconds: 1084,
    message_count: 1_585_221,
    topics: ["/robot01/livox/lidar", "/robot01/livox/imu"],
    compression: null,
    ...over,
  };
}

export function taskTemplate(over: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Morning round",
    description: "",
    map_name: MAP_NAME,
    steps: [
      {
        id: "1-move",
        vertex_id: vertex().id,
        vertex_name: "dock",
        vertex_status: "CURRENT",
        type: "MOVE",
        params: { x: 2.5, y: 1.25, theta: 90 },
        resolved_params: { x: 2.5, y: 1.25, theta: 90 },
      },
    ],
    map_matches_active: true,
    missing_vertex_count: 0,
    created_at: "2026-09-10T08:00:00Z",
    updated_at: "2026-09-10T08:00:00Z",
    ...over,
  };
}

export function taskHistoryEntry(over: Record<string, unknown> = {}) {
  return {
    id: "robot01-task-1758000000-1",
    run_id: "run-1",
    status: "COMPLETED",
    started_at: "2026-09-18T09:40:00Z",
    closed_at: "2026-09-18T09:44:12Z",
    source: "DIRECT",
    schedule_id: null,
    kind: "task",
    name: null,
    map_name: MAP_NAME,
    ...over,
  };
}

/**
 * A job running right now, as GET /active_tasks lists it — on this robot's
 * map unless a test says otherwise, which is what locks that map's writes.
 */
export function activeTask(over: Record<string, unknown> = {}) {
  return {
    id: "robot01-task-1758000000-1",
    run_id: "run-1",
    status: "IN_PROGRESS",
    started_at: "2026-09-18T09:44:30Z",
    source: "DIRECT",
    schedule_id: null,
    kind: "task",
    name: "Morning round",
    map_name: MAP_NAME,
    ...over,
  };
}

/**
 * A running job's own state, as GET /tasks/<id> reports it: a three-step
 * task on its second step, which is what the masthead reads the step from
 * (the active list carries no steps). Step ids follow the composer's
 * `${ordinal}-${type}` shape, so the readout can name the type.
 */
export function taskState(over: Record<string, unknown> = {}) {
  return {
    id: "robot01-task-1758000000-1",
    status: "IN_PROGRESS",
    steps: [
      { id: "1-move", status: "COMPLETED", error_msg: "" },
      { id: "2-speak", status: "IN_PROGRESS", error_msg: "" },
      { id: "3-move", status: "PENDING", error_msg: "" },
    ],
    ...over,
  };
}

/** `taskState`'s run once it has ended: every step done. */
function finishedTaskState(id: string) {
  const running = taskState({ id });
  return {
    ...running,
    status: "COMPLETED",
    steps: running.steps.map((step) => ({ ...step, status: "COMPLETED" })),
  };
}

/**
 * A history filter, applied the way the backend does: outcome, kind and name
 * match exactly, the bounds are on the close time. Shared by the page and
 * stats routes so the counts cannot disagree with the rows.
 */
function historyRows(
  rows: Record<string, unknown>[],
  params: URLSearchParams,
): Record<string, unknown>[] {
  const status = params.get("status");
  const kind = params.get("kind");
  const name = params.get("name");
  const since = params.get("since");
  const until = params.get("until");
  return rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (kind && row.kind !== kind) return false;
    if (name && row.name !== name) return false;
    const closed =
      typeof row.closed_at === "string" ? Date.parse(row.closed_at) : NaN;
    if (since && !(closed >= Date.parse(since))) return false;
    if (until && !(closed <= Date.parse(until))) return false;
    return true;
  });
}

/** GET /task_history/stats, counted from the same rows the page serves. */
function historyStats(
  rows: Record<string, unknown>[],
  params: URLSearchParams,
) {
  const matched = historyRows(rows, params);
  const by = (status: string) =>
    matched.filter((row) => row.status === status).length;
  const completed = by("COMPLETED");
  return {
    as_of: "2026-09-18T10:00:00Z",
    total: matched.length,
    by_status: {
      COMPLETED: completed,
      FAILED: by("FAILED"),
      CANCELED: by("CANCELED"),
    },
    success_rate: matched.length ? completed / matched.length : null,
  };
}

/** What every screen needs before it will render anything but a guard state. */
export interface BackendOverrides {
  /** Null makes GET /robot/state 404, which is the pre-localization state. */
  state?: Record<string, unknown> | null;
  maps?: Record<string, unknown>[];
  vertices?: Record<string, unknown>[];
  recordings?: Record<string, unknown>[];
  activeRecording?: Record<string, unknown> | null;
  templates?: Record<string, unknown>[];
  schedules?: Record<string, unknown>[];
  activeTasks?: Record<string, unknown>[];
  /** Finished runs, newest close first, as GET /task_history pages them. */
  taskHistory?: Record<string, unknown>[];
  /** Rows per history page; the fake's cursor is the offset of the next one. */
  taskHistoryPageSize?: number;
  /**
   * GET /tasks/<id> bodies by id. An id in `activeTasks` with none answers
   * the default `taskState`; any other id with none answers 404.
   */
  taskStates?: Record<string, Record<string, unknown>>;
  /** The floor plan every map's /image answers with; see floorPlanPng. */
  gridImage?: Buffer;
  /** The tree every map's /octomap answers with; see octomapBt. */
  octomap?: Buffer;
  /**
   * The ground patches by map name, as GET .../octomap/edits lists them
   * (`fill_key` triples); none by default. A PUT replaces a map's list.
   */
  octomapEdits?: Record<string, number[][]>;
  /**
   * The floors by map name, as GET .../floors lists them: `detected` is what
   * the walk found, `saved` an operator's list if there is one. One storey
   * (nothing either way) by default; a PUT saves a map's list.
   */
  floors?: Record<string, { detected?: MapFloorFixture[]; saved?: MapFloorFixture[] }>;
  /** GET /robot/restart's record before any press; `idle` by default. */
  restart?: Record<string, unknown>;
  /** Forbidden zones by map name, as GET .../keepout lists them; none by default. */
  keepout?: Record<string, Record<string, unknown>[]>;
  /**
   * GET /mapping's answer before any press. `unknown` by default — what a
   * navigating robot says; a mapping test hands in `idle` or `mapping`.
   */
  mappingStatus?: Record<string, unknown>;
  /**
   * GET /network/wifi/connections. By default the network the state fixture
   * is on (`site-wifi`) and one other; a forget removes its row.
   */
  wifiConnections?: Record<string, unknown>[];
  /** GET /network/wifi/scan's networks. */
  wifiNetworks?: Record<string, unknown>[];
}

/** One floor, as GET .../floors lists it. */
export interface MapFloorFixture {
  name: string;
  level: number;
}

/** A building of two storeys, as the robot's walk finds them. */
export const TWO_FLOORS: MapFloorFixture[] = [
  { name: "1F", level: -0.2 },
  { name: "2F", level: 5.5 },
];

/** A saved network, as GET /network/wifi/connections lists one. */
export function wifiConnection(
  over: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    uuid: "5f2c-site",
    name: "site-wifi",
    ssid: "site-wifi",
    active: true,
    last_used_at: "2026-09-18T09:00:00Z",
    ...over,
  };
}

/**
 * Not every write body is JSON (WHEP posts an SDP offer). A throw here would
 * leave the request unfulfilled and hang the page, so a non-JSON body is
 * logged as text.
 */
function parseBody(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

/**
 * Install the whole surface. Returns a log of the non-GET requests, so a test
 * can assert what the console sent, not only what the screen shows.
 */
export async function mockBackend(page: Page, over: BackendOverrides = {}) {
  const writes: { method: string; path: string; body: unknown }[] = [];

  const json = (route: Route, body: unknown, status = 200) =>
    route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(body),
    });

  const state = over.state === undefined ? robotState() : over.state;
  // The driver's safety lock; the estop write below moves it, so the strip's
  // next poll sees a lock land or lift.
  let safetyLocked = Boolean(
    (state?.low_level_mode as { safety_locked?: boolean } | undefined)?.safety_locked,
  );
  const maps = over.maps ?? [mapSummary()];
  // Typed as rows: the POST route below appends whatever the console sent.
  const vertices: Record<string, unknown>[] = over.vertices ?? [vertex()];
  let createdSerial = 0;
  const recordings = over.recordings ?? [recording()];
  const activeRecording =
    over.activeRecording === undefined ? null : over.activeRecording;
  const templates = over.templates ?? [taskTemplate()];
  const schedules = over.schedules ?? [];
  const activeTasks = over.activeTasks ?? [];
  const taskHistory = over.taskHistory ?? [];
  const taskHistoryPageSize = over.taskHistoryPageSize ?? 20;
  const taskStates = over.taskStates ?? {};
  // Every id the active list has carried. A test ends a job by emptying the
  // list, and the backend still answers a finished run from retention.
  const listedTaskIds = new Set<string>();
  const gridImage = over.gridImage ?? PNG_1PX;
  const octomap = over.octomap ?? octomapBt();
  // Copied: the PUT below replaces a map's list, and a test's fixture must
  // not change under it.
  const keepout: Record<string, Record<string, unknown>[]> = {
    ...over.keepout,
  };
  const octomapEdits: Record<string, number[][]> = { ...over.octomapEdits };
  const floors: Record<string, { detected?: MapFloorFixture[]; saved?: MapFloorFixture[] }> = {
    ...over.floors,
  };
  // The mapping run state; the run writes below move it, so the rail's next
  // poll sees a start land or a save end the run.
  let mappingStatus: Record<string, unknown> = over.mappingStatus ?? {
    state: "unknown",
    key_poses: 0,
    loop_closures: 0,
  };
  // Copied for the same reason as `keepout`: the DELETE below removes rows.
  const wifiConnections: Record<string, unknown>[] = [
    ...(over.wifiConnections ?? [
      wifiConnection(),
      wifiConnection({
        uuid: "9a1e-lab",
        name: "lab-5g",
        ssid: "lab-5g",
        active: false,
        last_used_at: "2026-09-10T15:30:00Z",
      }),
    ]),
  ];
  const wifiNetworks = over.wifiNetworks ?? [
    { bssid: "aa:bb:cc:dd:ee:ff", ssid: "site-wifi", rssi: -52 },
    { bssid: "aa:bb:cc:dd:ee:01", ssid: "guest", rssi: -70 },
  ];
  // The backend's record of the latest restart; the POST below moves it on.
  let restart: Record<string, unknown> = over.restart ?? {
    status: "idle",
    message: "",
    started_at: null,
    finished_at: null,
  };

  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method !== "GET") {
      writes.push({ method, path, body: parseBody(request.postData()) });
    }

    // Reads -------------------------------------------------------------
    if (path === "/api/v1/robot/state") {
      return state
        ? json(route, {
            ...state,
            low_level_mode: {
              ...(state.low_level_mode as Record<string, unknown>),
              safety_locked: safetyLocked,
            },
          })
        : json(
            route,
            { detail: "The robot has not published a state frame yet." },
            404,
          );
    }
    if (path === "/api/v1/robot/restart" && method === "GET") {
      return json(route, restart);
    }
    if (path === "/api/v1/mapping" && method === "GET") {
      return json(route, mappingStatus);
    }
    if (path === "/api/v1/network/wifi/scan") {
      return json(route, { networks: wifiNetworks });
    }
    if (path === "/api/v1/network/wifi/connect" && method === "POST") {
      const { ssid } = parseBody(request.postData()) as { ssid: string };
      return json(route, { message: `Successfully connected to ${ssid}` });
    }
    if (path === "/api/v1/network/wifi/connections" && method === "GET") {
      return json(route, { connections: wifiConnections });
    }
    const savedNetwork = path.match(
      /^\/api\/v1\/network\/wifi\/connections\/([^/]+)(\/activate)?$/,
    );
    if (savedNetwork) {
      const uuid = decodeURIComponent(savedNetwork[1]);
      const index = wifiConnections.findIndex((c) => c.uuid === uuid);
      if (index < 0) {
        return json(route, { detail: "That saved network no longer exists" }, 400);
      }
      const row = wifiConnections[index];
      if (savedNetwork[2] && method === "POST") {
        return json(route, { message: `Successfully connected to ${row.ssid}` });
      }
      if (method === "DELETE") {
        if (row.active) {
          return json(
            route,
            { detail: `Cannot forget ${row.ssid} while the robot is connected to it` },
            400,
          );
        }
        wifiConnections.splice(index, 1);
        return route.fulfill({ status: 204, body: "" });
      }
    }
    if (path === "/api/v1/active_tasks") {
      for (const task of activeTasks) listedTaskIds.add(task.id as string);
      return json(route, { tasks: activeTasks, as_of: "2026-09-18T09:45:00Z" });
    }
    if (path === "/api/v1/task_history/stats") {
      return json(route, historyStats(taskHistory, url.searchParams));
    }
    if (path === "/api/v1/task_history") {
      // The fake's cursor is the offset of the next page's first row.
      const rows = historyRows(taskHistory, url.searchParams);
      const offset = Number(url.searchParams.get("page_token") ?? 0);
      const end = offset + taskHistoryPageSize;
      return json(route, {
        tasks: rows.slice(offset, end),
        next_page_token: end < rows.length ? String(end) : null,
      });
    }
    if (path === "/api/v1/tasks" && method === "POST") {
      // The ack's id is what the tracker polls; the catch-all's `{ message }`
      // would fail the ack schema.
      const body = parseBody(request.postData()) as { id?: string } | null;
      return json(route, {
        id: body?.id ?? "robot01-task-0-0",
        status: "PENDING",
        message: "ok",
      });
    }
    const holdMatch = /^\/api\/v1\/tasks\/([^/]+)\/(pause|resume)$/.exec(path);
    if (holdMatch && method === "POST") {
      // The ack is a claim about the request (PAUSING, not PAUSED); the run's
      // state moves here so the console's next read sees the hold land.
      const id = decodeURIComponent(holdMatch[1]);
      const run = taskStates[id] as
        | { status: string; steps?: { status: string }[] }
        | undefined;
      if (!run) return json(route, { detail: `Task ${id} not found` }, 404);
      const pausing = holdMatch[2] === "pause";
      run.status = pausing ? "PAUSED" : "IN_PROGRESS";
      const live = run.steps?.find(
        (step) => step.status === "IN_PROGRESS" || step.status === "PAUSED",
      );
      if (live) live.status = pausing ? "PAUSED" : "IN_PROGRESS";
      return json(route, {
        id,
        status: pausing ? "PAUSING" : "IN_PROGRESS",
        message: pausing
          ? `Pause of task ${id} requested; poll GET /api/v1/tasks/${id} until its status is PAUSED.`
          : `Task ${id} resumed.`,
      });
    }
    const taskMatch = /^\/api\/v1\/tasks\/([^/]+)$/.exec(path);
    if (taskMatch && method === "GET") {
      const id = decodeURIComponent(taskMatch[1]);
      // A listed job without a spelled-out state answers the default: the
      // masthead reads every running job, and a 404 would trip the
      // console-error guard. One that has left the list answers finished,
      // since the masthead's 1 Hz read can land before the 2 s list poll
      // notices. An id never listed still answers 404.
      const state =
        taskStates[id] ??
        (activeTasks.some((task) => task.id === id)
          ? taskState({ id })
          : listedTaskIds.has(id)
            ? finishedTaskState(id)
            : undefined);
      return state
        ? json(route, state)
        : json(route, { detail: `Task ${id} not found` }, 404);
    }
    if (path === "/api/v1/maps" && method === "GET") return json(route, maps);
    const activateMatch = /^\/api\/v1\/maps\/([^/]+)\/activate$/.exec(path);
    if (activateMatch && method === "POST") {
      // The backend's rule: a floor plan or a 3D map, either one. `active`
      // moves, so the cards' next read shows the switch.
      const name = decodeURIComponent(activateMatch[1]);
      const map = maps.find((entry) => entry.name === name);
      if (!map) return json(route, { detail: `Map "${name}" not found` }, 404);
      if (map.grid_status !== "ok" && map.octomap_status !== "ok") {
        return json(
          route,
          { detail: `'${name}' has no floor plan and no 3D map.`, code: "grid_missing" },
          409,
        );
      }
      const previous = maps.find((entry) => entry.active)?.name ?? null;
      for (const entry of maps) entry.active = entry.name === name;
      return json(route, {
        name,
        previous,
        switched: true,
        localized: false,
        message: `Switched to '${name}'. Set an initial pose on the dashboard.`,
      });
    }
    const mapMatch = /^\/api\/v1\/maps\/([^/]+)$/.exec(path);
    if (mapMatch && method === "GET") {
      // The editor's first request; a name not in the catalogue is a 404
      // sentence, the way the backend answers.
      const name = decodeURIComponent(mapMatch[1]);
      const map = maps.find((entry) => entry.name === name);
      return map
        ? json(route, map)
        : json(route, { detail: `Map "${name}" not found` }, 404);
    }
    const verticesMatch = /^\/api\/v1\/maps\/([^/]+)\/vertices$/.exec(path);
    if (verticesMatch && method === "GET") {
      // Per map: one list for every map would pass a picker that ignored the
      // choice.
      const name = decodeURIComponent(verticesMatch[1]);
      return json(
        route,
        vertices.filter((entry) => entry.map_name === name),
      );
    }
    const editsMatch = /^\/api\/v1\/maps\/([^/]+)\/octomap\/edits$/.exec(path);
    if (editsMatch && method === "GET") {
      const name = decodeURIComponent(editsMatch[1]);
      const keys = octomapEdits[name];
      return json(route, {
        name,
        res: keys ? 0.1 : null,
        fill_key: keys ?? [],
        created_at: keys ? "2026-10-14T03:00:00Z" : null,
      });
    }
    if (editsMatch && method === "PUT") {
      const name = decodeURIComponent(editsMatch[1]);
      const body = parseBody(route.request().postData()) as { fill_key?: number[][] } | null;
      const keys = body?.fill_key ?? [];
      octomapEdits[name] = keys;
      return json(route, {
        name,
        count: keys.length,
        message:
          keys.length === 0
            ? `Cleared the ground patches of '${name}'.`
            : `Saved ${keys.length} ground ${keys.length === 1 ? "patch" : "patches"} for '${name}'. They take effect once applied to the robot's 3D map.`,
      });
    }
    const floorsMatch = /^\/api\/v1\/maps\/([^/]+)\/floors$/.exec(path);
    if (floorsMatch && method === "GET") {
      const name = decodeURIComponent(floorsMatch[1]);
      const entry = floors[name] ?? {};
      const detected = entry.detected ?? [];
      return json(route, {
        name,
        floors: entry.saved ?? detected,
        detected,
        saved: entry.saved !== undefined,
      });
    }
    if (floorsMatch && method === "PUT") {
      const name = decodeURIComponent(floorsMatch[1]);
      const body = parseBody(route.request().postData()) as { floors?: MapFloorFixture[] } | null;
      const saved = [...(body?.floors ?? [])]
        .map((floor) => ({ name: floor.name.trim(), level: floor.level }))
        .sort((a, b) => a.level - b.level);
      floors[name] = { ...floors[name], saved };
      return json(route, {
        name,
        floors: saved,
        message: saved.length
          ? `Saved ${saved.length} floor${saved.length === 1 ? "" : "s"} for '${name}'.`
          : `Saved '${name}' as one floor.`,
      });
    }
    const keepoutMatch = /^\/api\/v1\/maps\/([^/]+)\/keepout$/.exec(path);
    if (keepoutMatch && method === "GET") {
      const name = decodeURIComponent(keepoutMatch[1]);
      const map = maps.find((entry) => entry.name === name);
      return json(route, {
        name,
        zones: keepout[name] ?? [],
        active: map?.active === true,
      });
    }
    if (path === "/api/v1/recordings" && method === "GET") {
      return json(route, { recordings });
    }
    if (path === "/api/v1/recordings/active") {
      return json(route, activeRecording);
    }
    if (path === "/api/v1/task_templates" && method === "GET") {
      return json(route, templates);
    }
    if (path === "/api/v1/schedules" && method === "GET") {
      return json(route, schedules);
    }

    // Writes. Enough of a body for the hook that reads the echo; a test that
    // needs more routes it itself.
    if (verticesMatch && method === "POST") {
      // The batch endpoint: an array in, the stored rows (with id and map)
      // out.
      const name = decodeURIComponent(verticesMatch[1]);
      const drafts = parseBody(request.postData()) as Record<string, unknown>[];
      // Numbered across the fake's life, not per request: the editor matches
      // rows by id, and reissued ids would leave two waypoints answering to one.
      const stored = drafts.map((draft) => ({
        ...draft,
        id: `33333333-3333-3333-3333-${String(createdSerial++).padStart(12, "0")}`,
        map_name: name,
      }));
      // Kept, so a later GET lists it the way the robot's would.
      vertices.push(...stored);
      return json(route, stored);
    }
    const vertexMatch = /^\/api\/v1\/maps\/([^/]+)\/vertices\/([^/]+)$/.exec(path);
    if (vertexMatch && method === "PUT") {
      // The stored row with the changes merged.
      const id = decodeURIComponent(vertexMatch[2]);
      const index = vertices.findIndex((entry) => entry.id === id);
      if (index < 0) return json(route, { detail: "Waypoint not found." }, 404);
      vertices[index] = {
        ...vertices[index],
        ...(parseBody(request.postData()) as Record<string, unknown>),
      };
      return json(route, vertices[index]);
    }
    if (vertexMatch && method === "DELETE") {
      const id = decodeURIComponent(vertexMatch[2]);
      const index = vertices.findIndex((entry) => entry.id === id);
      if (index >= 0) vertices.splice(index, 1);
      return json(route, { message: "Deleted." });
    }
    if (keepoutMatch && method === "PUT") {
      // The whole list replaces the old one, and the running planner reloads
      // it only when this is the map it is on — the two answers the save
      // note tells apart.
      const name = decodeURIComponent(keepoutMatch[1]);
      const map = maps.find((entry) => entry.name === name);
      const active = map?.active === true;
      const zones = (
        parseBody(request.postData()) as { zones: Record<string, unknown>[] }
      ).zones;
      keepout[name] = zones;
      const count = `${zones.length} forbidden zone${zones.length === 1 ? "" : "s"}`;
      return json(route, {
        name,
        zones,
        active,
        reloaded: active,
        message: active
          ? `Saved ${count} for '${name}' and reloaded the keepout filter.`
          : `Saved ${count} for '${name}'.`,
      });
    }
    if (path === "/api/v1/recordings/stop") {
      return json(route, {
        name: "rec_20260918T0922Z",
        path: "/home/syncai/record/rec_20260918T0922Z",
        topics: [],
        started_at: "2026-09-18T09:22:00Z",
        elapsed_seconds: 42,
        size_bytes: 1024,
        stopped_by: "sigint",
        complete: true,
      });
    }
    const scheduleMatch = /^\/api\/v1\/schedules\/([^/]+)$/.exec(path);
    if (scheduleMatch && method === "PATCH") {
      // Applied to the list: the hook re-reads after an edit, and the old
      // trigger would reappear mid-assertion.
      const id = decodeURIComponent(scheduleMatch[1]);
      const entry = schedules.find((row) => row.id === id);
      if (!entry)
        return json(route, { detail: `Schedule ${id} not found` }, 404);
      entry.trigger = (
        parseBody(request.postData()) as { trigger: unknown }
      ).trigger;
      return json(route, {
        id,
        message: `Schedule ${id} trigger has been updated.`,
      });
    }
    if (path === "/api/v1/maps/import" && method === "POST") {
      // Lands in the catalogue so the refetch mounts a card. Without the
      // console's `name` override the robot reads the archive's manifest,
      // which this fake cannot, so it uses a fixed name.
      const name = url.searchParams.get("name") ?? "imported";
      const replaced = maps.some((entry) => entry.name === name);
      if (!replaced) maps.push(mapSummary({ active: false, name }));
      return json(
        route,
        {
          name,
          replaced,
          files: 7,
          bytes: 24_117_248,
          vertices_created: 2,
          vertices_deleted: 0,
          message: `${replaced ? "Replaced" : "Imported"} '${name}': 7 files and 2 vertices.`,
        },
        201,
      );
    }
    if (path === "/api/v1/mapping/start" && method === "POST") {
      // Refused the way the backend refuses it, from the latched state; a
      // test that wants a different refusal routes it itself.
      if (mappingStatus.state === "mapping") {
        return json(
          route,
          {
            detail: "The robot is already building a map. Save it, or start a new one with a reset.",
            code: "mapping_running",
          },
          409,
        );
      }
      mappingStatus = { state: "mapping", key_poses: 0, loop_closures: 0 };
      return json(route, {
        started: true,
        message:
          "Mapping started. The map begins building once the lidar has re-levelled — keep the robot still until then.",
      });
    }
    if (path === "/api/v1/maps" && method === "POST") {
      // A save ends the run, so the next poll moves the rail back to Start.
      // The catch-all's `{ message }` would fail the save schema.
      const body = parseBody(request.postData()) as {
        name?: string;
        grid?: boolean;
        octomap?: boolean;
      } | null;
      const name = body?.name ?? "map";
      mappingStatus = { state: "idle", key_poses: 0, loop_closures: 0 };
      // A save that asked for the 3D map lists at once as building it, as
      // the robot's cleaning writes its sidecar before the save answers. A
      // test that passed `maps` holds the array and can finish the build.
      if (body?.octomap) {
        maps.push(
          mapSummary({
            name,
            active: false,
            grid: null,
            thumbnail: null,
            grid_status: "none",
            octomap_status: "converting",
          }),
        );
      }
      return json(route, {
        name,
        has_pointcloud: true,
        grid_pending: false,
        message: `Saved '${name}'. Mapping has stopped — start it again for another map.`,
      });
    }
    if (path === "/api/v1/mapping/reset" && method === "POST") {
      mappingStatus = { ...mappingStatus, key_poses: 0, loop_closures: 0 };
      return json(route, {
        reset: true,
        message:
          "Map discarded. The new one starts building once the lidar has re-levelled — keep the robot still until then.",
      });
    }
    if (path === "/api/v1/robot/restart" && method === "POST") {
      // Dispatched; the outcome lands on the GET below. A test that needs the
      // rebuild to end, or the press refused, routes it itself.
      restart = {
        status: "restarting",
        message: "",
        started_at: "2026-09-18T09:45:00Z",
        finished_at: null,
      };
      return json(route, {
        restarting: true,
        message:
          "Restarting the live mode; poll GET /api/v1/robot/restart for the outcome.",
      });
    }
    if (path === "/api/v1/robot/estop" && method === "POST") {
      // The backend's edge rule: only an engage of a lock that was off
      // cancels, and it cancels every running job itself.
      const { locked } = parseBody(request.postData()) as { locked: boolean };
      const cancelRequested = locked && !safetyLocked;
      safetyLocked = locked;
      if (cancelRequested) activeTasks.length = 0;
      return json(route, {
        locked,
        cancel_requested: cancelRequested,
        message: locked
          ? cancelRequested
            ? "Safety lock engaged; cancelling every running task."
            : "Safety lock was already engaged."
          : "Safety lock released.",
      });
    }
    if (path === "/api/v1/localization/auto" && method === "POST") {
      // A match that held, the usual answer. A test that needs the search to
      // fail or take its time routes it itself.
      return json(route, {
        localized: true,
        message: "matched",
        x: 1.25,
        y: -3.5,
        z: 0.02,
        theta: 90,
        fitness: 0.018,
        inlier_ratio: 0.87,
        candidates: 480,
      });
    }
    if (path === "/api/v1/robot/set_motion_key" && method === "POST") {
      // The backend's own answer: every key is forwarded except the
      // emergency stop, which it accepts and holds back.
      const { key } = parseBody(request.postData()) as { key: string };
      return json(route, {
        key,
        sent: key !== "4",
        message: key === "4" ? "Emergency stop is not forwarded." : "Sent.",
      });
    }
    if (method === "DELETE") return route.fulfill({ status: 204, body: "" });

    return json(route, { message: "ok" });
  });

  // Binary assets, answered with minimal real payloads rather than a 404: a
  // failed subresource is a console error, and ignoring those would also
  // ignore the ones that mean something.
  await page.route(/\/api\/v1\/maps\/[^/]+\/(image|thumbnail)$/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: gridImage }),
  );
  await page.route(/\/api\/v1\/maps\/[^/]+\/export$/, (route) =>
    // The console never opens the archive; a few bytes of the right type do.
    route.fulfill({
      status: 200,
      contentType: "application/zip",
      body: Buffer.from("PK\x05\x06", "latin1"),
    }),
  );
  await page.route(/\/api\/v1\/maps\/[^/]+\/pointcloud$/, (route) =>
    // The wire format is [u32 count][f32 xyz…]; zero points is four zero bytes.
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: Buffer.alloc(4),
    }),
  );
  await page.route(/\/api\/v1\/maps\/[^/]+\/octomap$/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/octet-stream",
      body: octomap,
    }),
  );

  return writes;
}

/**
 * Fail a test on any console error the page logs: a hydration mismatch, a
 * thrown render, a failed schema parse. WebSocket errors are filtered, since
 * there is no robot to connect to.
 */
export function failOnConsoleErrors(page: Page, errors: string[]) {
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (/websocket|ws:\/\//i.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(String(error)));
}
