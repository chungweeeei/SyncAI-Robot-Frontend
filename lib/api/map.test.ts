import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchMapOctomap, fetchMaps } from "@/lib/api/map";
import { encodeOctomapBt } from "@/lib/map/octree";
import { OCTREE_KEY_ORIGIN } from "@/lib/types/octree";

/**
 * The catalogue's 3D map fields and the tree download. The fields are the one
 * place the wire schema is tolerant on purpose: a robot running an older
 * backend lists its maps without them, and the console must still read the
 * catalogue.
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

/** A catalogue row as the backend sends it, before the 3D map fields existed. */
function olderRow(over: Record<string, unknown> = {}) {
  return {
    name: "dp2f",
    active: true,
    grid: null,
    thumbnail: null,
    has_pointcloud: true,
    grid_status: "none",
    grid_error: null,
    grid_converting: false,
    size_bytes: 1,
    modified_at: "2026-09-18T09:22:41Z",
    vertex_count: 0,
    ...over,
  };
}

describe("fetchMaps", () => {
  it("reads a catalogue from a backend that knows no 3D map as having none", async () => {
    fetchMock.mockResolvedValue(answer([olderRow()]));
    const [map] = await fetchMaps();
    expect(map.octomap_status).toBe("none");
    expect(map.octomap_error).toBeNull();
    expect(map.octomap_version).toBeNull();
    expect(map.octomap_resolution).toBeNull();
  });

  it("carries the 3D map fields through when the backend sends them", async () => {
    fetchMock.mockResolvedValue(
      answer([
        olderRow({
          octomap_status: "ok",
          octomap_error: null,
          octomap_version: "2971216-1760414598000000000",
          octomap_resolution: 0.1,
        }),
      ]),
    );
    const [map] = await fetchMaps();
    expect(map.octomap_status).toBe("ok");
    expect(map.octomap_version).toBe("2971216-1760414598000000000");
    expect(map.octomap_resolution).toBe(0.1);
  });

  it("refuses a 3D map status it does not know, naming the field", async () => {
    fetchMock.mockResolvedValue(answer([olderRow({ octomap_status: "building" })]));
    await expect(fetchMaps()).rejects.toThrow(/octomap_status/);
  });
});

describe("fetchMapOctomap", () => {
  it("downloads the tree and hands back its occupied cells", async () => {
    const O = OCTREE_KEY_ORIGIN;
    const tree = encodeOctomapBt({ res: 0.1, occupied: [[O + 1, O, O - 5]] });
    fetchMock.mockResolvedValue(
      new Response(tree.buffer.slice(0, tree.byteLength) as ArrayBuffer, {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );

    const voxels = await fetchMapOctomap("dp2f");

    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toMatch(/\/api\/v1\/maps\/dp2f\/octomap$/);
    expect(voxels.count).toBe(1);
    expect(voxels.keyMin).toEqual([O + 1, O, O - 5]);
    expect(voxels.res).toBe(0.1);
  });

  it("renders a refusal as the backend's own sentence", async () => {
    fetchMock.mockResolvedValue(
      answer({ detail: "The 3D map of 'dp2f' is still being built", code: "octomap_converting" }, 409),
    );
    await expect(fetchMapOctomap("dp2f")).rejects.toThrow(
      "The 3D map of 'dp2f' is still being built",
    );
  });

  it("reports a body that is not a tree in the operator's words", async () => {
    fetchMock.mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    );
    await expect(fetchMapOctomap("dp2f")).rejects.toThrow(/not in a form this console can read/);
  });
});
