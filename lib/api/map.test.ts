import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchMaps } from "@/lib/api/map";

/**
 * The catalogue row as the backend writes it since it learned about the 3D
 * map. The rule these hold: the three 3D map fields are required, not
 * optional — the dashboard decides whether to offer its layer off
 * `octomap_status`, and a backend too old to send it must fail at the schema
 * rather than arrive as `undefined` and hide the layer for no stated reason.
 */
const row = (extra: Record<string, unknown> = {}) => ({
  name: "dp1f",
  active: true,
  grid: { resolution: 0.05, origin: { x: -10, y: -5, yaw: 0 }, width: 400, height: 200 },
  thumbnail: "/api/v1/maps/dp1f/thumbnail",
  has_pointcloud: true,
  grid_status: "ok",
  grid_error: null,
  grid_converting: false,
  octomap_status: "ok",
  octomap_error: null,
  octomap_resolution: 0.1,
  size_bytes: 1024,
  modified_at: "2026-10-08T03:00:00Z",
  vertex_count: 0,
  ...extra,
});

function serve(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ),
  );
}

describe("fetchMaps and the 3D map fields", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("passes the 3D map's status, error and cell size through", async () => {
    serve([row({ octomap_status: "failed", octomap_error: "road layer is empty", octomap_resolution: null })]);
    const [map] = await fetchMaps();
    expect(map.octomap_status).toBe("failed");
    expect(map.octomap_error).toBe("road layer is empty");
    expect(map.octomap_resolution).toBeNull();
  });

  it("refuses a catalogue without octomap_status, naming the field", async () => {
    const legacy: Record<string, unknown> = row();
    delete legacy.octomap_status;
    serve([legacy]);
    await expect(fetchMaps()).rejects.toThrow(/octomap_status/);
  });

  it("refuses a status outside the closed union", async () => {
    serve([row({ octomap_status: "building" })]);
    await expect(fetchMaps()).rejects.toThrow(/octomap_status/);
  });
});
