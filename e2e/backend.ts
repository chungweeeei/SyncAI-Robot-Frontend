import { deflateSync } from "node:zlib";

import type { Page, Route } from "@playwright/test";

/**
 * A fake `syncai_backend`, installed per test.
 *
 * The console targets `<page hostname>:3000` (see lib/api/config.ts), so the
 * routes below match on path and ignore the host — a test does not have to know
 * which port the client resolved.
 *
 * Every fixture is written from the interfaces in `lib/api/*` and
 * `lib/types/*`, which is also what the zod schemas mirror: a fixture that
 * drifts from the wire shape fails the schema at the boundary, loudly, which is
 * the behaviour we want from a stale fixture rather than a green test.
 */

export const MAP_NAME = "dp2f";

/** A 1x1 transparent PNG, so an <img> and a TextureLoader both succeed. */
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

/**
 * A floor plan the editor can actually paint on: an 8-bit greyscale PNG of
 * `width` x `height` cells, every one `byte` (254 is free, 0 an obstacle, 205
 * unknown — see classify in lib/map/grid.ts).
 *
 * The 1x1 default is enough for a card's thumbnail and the viewport's ground
 * texture, but the editor reads the image *as the grid*: one pixel is one
 * cell, fitted to the whole canvas, and any zoom then shrinks it to 32 px —
 * so a test that strokes or pinches after zooming was touching nothing.
 * Hand this to `gridImage` for those.
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
    low_level_mode: { policy: "PPO", motion: "LOCOMOTION" },
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
    ...over,
  };
}

export function vertex(over: Record<string, unknown> = {}) {
  return {
    id: "11111111-1111-1111-1111-111111111111",
    name: "dock",
    type: "CHARGER",
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
 * The finished runs a history read's filter names, the way the backend
 * applies it: outcome, kind and name are exact matches, and the two bounds
 * are on the close time. Shared by the page and the stats routes so the
 * counts above the list can never disagree with the rows in it.
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
  /** GET /tasks/<id> bodies by id; an id with none answers 404. */
  taskStates?: Record<string, Record<string, unknown>>;
  /** The floor plan every map's /image answers with; see floorPlanPng. */
  gridImage?: Buffer;
  /** GET /robot/restart's record before any press; `idle` by default. */
  restart?: Record<string, unknown>;
  /** Forbidden zones by map name, as GET .../keepout lists them; none by default. */
  keepout?: Record<string, Record<string, unknown>[]>;
}

/**
 * Every write body a test asserts on is JSON, but not every write body is: the
 * WHEP handshake posts an SDP offer. Parsing that as JSON used to throw inside
 * the route handler, which never fulfilled the request -- so the page hung and
 * the failure surfaced as whatever the test happened to be waiting for. A
 * non-JSON body is logged as its own text instead.
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
 * Install the whole surface. Returns a log of the non-GET requests that
 * reached it, so a test can assert the console actually sent what the button
 * promised rather than only that the screen changed.
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
  const maps = over.maps ?? [mapSummary()];
  // Typed as rows rather than left to the fixture's exact shape, because the
  // POST route below appends whatever the console sent.
  const vertices: Record<string, unknown>[] = over.vertices ?? [vertex()];
  const recordings = over.recordings ?? [recording()];
  const activeRecording =
    over.activeRecording === undefined ? null : over.activeRecording;
  const templates = over.templates ?? [taskTemplate()];
  const schedules = over.schedules ?? [];
  const activeTasks = over.activeTasks ?? [];
  const taskHistory = over.taskHistory ?? [];
  const taskHistoryPageSize = over.taskHistoryPageSize ?? 20;
  const taskStates = over.taskStates ?? {};
  const gridImage = over.gridImage ?? PNG_1PX;
  // Copied, because the PUT below replaces a map's list the way the robot's
  // would, and a test's fixture object must not change under it.
  const keepout: Record<string, Record<string, unknown>[]> = {
    ...over.keepout,
  };
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
        ? json(route, state)
        : json(
            route,
            { detail: "The robot has not published a state frame yet." },
            404,
          );
    }
    if (path === "/api/v1/robot/restart" && method === "GET") {
      return json(route, restart);
    }
    if (path === "/api/v1/active_tasks") {
      return json(route, { tasks: activeTasks, as_of: "2026-09-18T09:45:00Z" });
    }
    if (path === "/api/v1/task_history/stats") {
      return json(route, historyStats(taskHistory, url.searchParams));
    }
    if (path === "/api/v1/task_history") {
      // Filters and a cursor the way the backend applies them (see
      // historyRows); the token is only meaningful to the fake that issued
      // it — here, the offset of the next page's first row.
      const rows = historyRows(taskHistory, url.searchParams);
      const offset = Number(url.searchParams.get("page_token") ?? 0);
      const end = offset + taskHistoryPageSize;
      return json(route, {
        tasks: rows.slice(offset, end),
        next_page_token: end < rows.length ? String(end) : null,
      });
    }
    if (path === "/api/v1/tasks" && method === "POST") {
      // The ack the console parses: its id is what the tracker then polls.
      // Without this the catch-all's `{ message }` fails the ack schema, and a
      // dispatch test would be testing a parse error.
      const body = parseBody(request.postData()) as { id?: string } | null;
      return json(route, {
        id: body?.id ?? "robot01-task-0-0",
        status: "PENDING",
        message: "ok",
      });
    }
    const taskMatch = /^\/api\/v1\/tasks\/([^/]+)$/.exec(path);
    if (taskMatch && method === "GET") {
      const id = decodeURIComponent(taskMatch[1]);
      return taskStates[id]
        ? json(route, taskStates[id])
        : json(route, { detail: `Task ${id} not found` }, 404);
    }
    if (path === "/api/v1/maps" && method === "GET") return json(route, maps);
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
      // Per map, the way the backend answers: the editor can now read a map
      // the robot is not on, and a fake that handed every map the same list
      // would pass a picker that ignored the choice.
      const name = decodeURIComponent(verticesMatch[1]);
      return json(
        route,
        vertices.filter((entry) => entry.map_name === name),
      );
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

    // Writes. Enough of a body for the hook that reads the echo; anything
    // a test needs to be specific about it overrides with its own route.
    if (verticesMatch && method === "POST") {
      // The batch endpoint: an array in, the stored rows out. Echoed with an
      // id and the map from the URL, which is what the hook's schema checks
      // and splices into the list the layer draws.
      const name = decodeURIComponent(verticesMatch[1]);
      const drafts = parseBody(request.postData()) as Record<string, unknown>[];
      const stored = drafts.map((draft, index) => ({
        ...draft,
        id: `33333333-3333-3333-3333-${String(index).padStart(12, "0")}`,
        map_name: name,
      }));
      // Kept, so a later GET lists it the way the robot's would.
      vertices.push(...stored);
      return json(route, stored);
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
      // Applied to the list, the way Temporal's would be: the hook re-reads
      // after an edit, and a fake that still answered the old trigger would
      // put it back on the row mid-assertion.
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
      // Lands in the catalogue the way the robot's would, so the refetch the
      // hook fires mounts a card for it. `name` is the console's override;
      // without one the robot reads the archive's manifest, which this fake
      // cannot, so it stands in a fixed name.
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
    if (path === "/api/v1/robot/restart" && method === "POST") {
      // Dispatched, the usual answer: the robot reports back only once the
      // rebuild is over, and that lands on the GET below. A test that needs
      // the rebuild to end, or the press refused, routes it itself.
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
    if (method === "DELETE") return route.fulfill({ status: 204, body: "" });

    return json(route, { message: "ok" });
  });

  // Binary assets the map card and the canvas ask for. Answered with real,
  // minimal payloads rather than a 404: the browser logs a failed subresource
  // as a console error, and a suite that has to ignore those would also ignore
  // the ones that mean something.
  await page.route(/\/api\/v1\/maps\/[^/]+\/(image|thumbnail)$/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: gridImage }),
  );
  await page.route(/\/api\/v1\/maps\/[^/]+\/export$/, (route) =>
    // The console never opens the archive; a few bytes under the right media
    // type is all the download path needs to hand to the operator's disk.
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

  return writes;
}

/**
 * Fail a test on any console error the page logs.
 *
 * Hydration mismatches, a thrown render and a failed schema parse all land
 * here, and all three are things that reach a screen looking merely odd. The
 * WebSocket streams are the one expected noise: there is no robot, so the
 * telemetry and cloud sockets cannot connect.
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
