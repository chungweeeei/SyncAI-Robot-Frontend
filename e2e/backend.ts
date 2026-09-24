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
    ...over,
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
  const vertices = over.vertices ?? [vertex()];
  const recordings = over.recordings ?? [recording()];
  const activeRecording =
    over.activeRecording === undefined ? null : over.activeRecording;
  const templates = over.templates ?? [taskTemplate()];
  const schedules = over.schedules ?? [];
  const activeTasks = over.activeTasks ?? [];
  const taskHistory = over.taskHistory ?? [];
  const taskHistoryPageSize = over.taskHistoryPageSize ?? 20;
  const taskStates = over.taskStates ?? {};

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
        : json(route, { detail: "The robot has not published a state frame yet." }, 404);
    }
    if (path === "/api/v1/active_tasks") {
      return json(route, { tasks: activeTasks, as_of: "2026-09-18T09:45:00Z" });
    }
    if (path === "/api/v1/task_history") {
      // Filters and a cursor the way the backend applies them: status is an
      // exact match, and the token is only meaningful to the fake that issued
      // it — here, the offset of the next page's first row.
      const status = url.searchParams.get("status");
      const rows = status
        ? taskHistory.filter((row) => row.status === status)
        : taskHistory;
      const offset = Number(url.searchParams.get("page_token") ?? 0);
      const end = offset + taskHistoryPageSize;
      return json(route, {
        tasks: rows.slice(offset, end),
        next_page_token: end < rows.length ? String(end) : null,
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
    if (path.endsWith("/vertices") && method === "GET") {
      return json(route, vertices);
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
    if (method === "DELETE") return route.fulfill({ status: 204, body: "" });

    return json(route, { message: "ok" });
  });

  // Binary assets the map card and the canvas ask for. Answered with real,
  // minimal payloads rather than a 404: the browser logs a failed subresource
  // as a console error, and a suite that has to ignore those would also ignore
  // the ones that mean something.
  await page.route(/\/api\/v1\/maps\/[^/]+\/(image|thumbnail)$/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PNG_1PX }),
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
