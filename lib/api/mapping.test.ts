import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMappingStatus, saveMap, startMapping } from "@/lib/api/mapping";

/**
 * Every run state the backend can answer parses, and an unpromised shape is
 * refused. The start is a bodyless POST, so no Content-Type (see http.ts).
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchMappingStatus", () => {
  it.each(["idle", "mapping", "resetting", "unknown"] as const)(
    "accepts the %s state",
    async (state) => {
      fetchMock.mockResolvedValue(answer({ state, key_poses: 3, loop_closures: 1 }));
      await expect(fetchMappingStatus()).resolves.toEqual({
        state,
        key_poses: 3,
        loop_closures: 1,
      });
    },
  );

  it("reads GET /api/v1/mapping with no body and no Content-Type", async () => {
    fetchMock.mockResolvedValue(answer({ state: "idle", key_poses: 0, loop_closures: 0 }));
    await fetchMappingStatus();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/mapping$/);
    expect(init.method).toBeUndefined();
    expect((init.headers as Headers).has("Content-Type")).toBe(false);
  });

  it("refuses a state this console does not know, naming the field", async () => {
    fetchMock.mockResolvedValue(answer({ state: "paused", key_poses: 0, loop_closures: 0 }));
    await expect(fetchMappingStatus()).rejects.toThrow(/state/);
  });

  it("refuses a keyframe count that is not a number", async () => {
    fetchMock.mockResolvedValue(answer({ state: "mapping", key_poses: "12", loop_closures: 0 }));
    await expect(fetchMappingStatus()).rejects.toThrow(/key_poses/);
  });
});

describe("startMapping", () => {
  it("posts to /api/v1/mapping/start with no body and no Content-Type", async () => {
    fetchMock.mockResolvedValue(answer({ started: true, message: "Mapping started." }));
    await expect(startMapping()).resolves.toEqual({
      started: true,
      message: "Mapping started.",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/mapping\/start$/);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Headers).has("Content-Type")).toBe(false);
  });

  it("rejects with the backend's own sentence on a refusal", async () => {
    fetchMock.mockResolvedValue(
      answer(
        {
          detail: "The robot is already building a map. Save it, or start a new one with a reset.",
          code: "mapping_running",
        },
        409,
      ),
    );
    await expect(startMapping()).rejects.toThrow(/already building a map/);
  });
});

describe("saveMap", () => {
  const saved = {
    name: "site_a",
    has_pointcloud: true,
    grid_pending: false,
    message: "Saved 'site_a'.",
  };

  // An unticked 3D map is sent as false, never left out: the backend reads a
  // missing one as "the robot's own setting", which may build it anyway.
  it("posts both choices, a false one included", async () => {
    fetchMock.mockResolvedValue(answer(saved));
    await saveMap("site_a", { grid: false, octomap: true });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/api\/v1\/maps$/);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "site_a",
      grid: false,
      octomap: true,
    });
  });

  it("sends an unticked 3D map as false", async () => {
    fetchMock.mockResolvedValue(answer(saved));
    await saveMap("site_a", { grid: true, octomap: false });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toHaveProperty("octomap", false);
  });
});
