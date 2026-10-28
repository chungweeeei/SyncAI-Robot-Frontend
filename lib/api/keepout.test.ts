import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchKeepout, saveKeepout } from "@/lib/api/keepout";

/**
 * The forbidden zones' wire. A zone may carry a name and the floor band the
 * robot's 3D planner applies it on, and a save is the whole list -- so a
 * field the console read must go back unchanged, or a save widens a zone to
 * every storey.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const corners = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
];

describe("fetchKeepout", () => {
  it("reads a zone's name and band, and a zone without them", async () => {
    fetchMock.mockResolvedValue(
      answer({
        name: "dp",
        active: true,
        zones: [
          { id: "a", points: corners, name: "rack", z_min: 4.5, z_max: 5.5 },
          { id: "b", points: corners, name: null, z_min: null, z_max: null },
          // An older backend's zone: the keys absent altogether.
          { id: "c", points: corners },
        ],
      }),
    );
    const { zones } = await fetchKeepout("dp");
    expect(zones[0]).toMatchObject({ name: "rack", z_min: 4.5, z_max: 5.5 });
    expect(zones[1].z_min).toBeNull();
    expect(zones[2].z_min).toBeUndefined();
  });
});

describe("saveKeepout", () => {
  it("sends the name and band back as read, null when unset", async () => {
    fetchMock.mockResolvedValue(
      answer({ name: "dp", zones: [], active: false, reloaded: false, message: "Saved." }),
    );
    await saveKeepout("dp", [
      { id: "a", points: corners, name: "rack", z_min: 4.5, z_max: 5.5 },
      { id: "b", points: corners },
    ]);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.zones[0]).toEqual({ id: "a", points: corners, name: "rack", z_min: 4.5, z_max: 5.5 });
    expect(body.zones[1]).toEqual({ id: "b", points: corners, name: null, z_min: null, z_max: null });
  });
});
