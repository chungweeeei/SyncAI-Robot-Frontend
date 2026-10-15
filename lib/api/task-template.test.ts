import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { listTaskTemplates } from "@/lib/api/task-template";

/**
 * A template read is parsed whole, so a step type the schema does not know
 * fails the entire library rather than one row: every type the backend can
 * store has to parse.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const DOCK = {
  id: "1-dock",
  type: "DOCK",
  vertex_id: "11111111-1111-1111-1111-111111111111",
  vertex_name: "dock",
  vertex_status: "CURRENT",
  group: null,
  params: { x: 2.5, y: 1.25, theta: 90 },
  resolved_params: { x: 2.5, y: 1.25, theta: 90 },
};

describe("listTaskTemplates", () => {
  it("reads a Dock with its waypoint and pose", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "t1",
            name: "charge",
            description: "",
            map_name: "wh1",
            steps: [DOCK],
            map_matches_active: true,
            missing_vertex_count: 0,
            created_at: "2026-10-15T00:00:00Z",
            updated_at: "2026-10-15T00:00:00Z",
          },
        ]),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const [template] = await listTaskTemplates();
    expect(template!.steps.map((step) => step.type)).toEqual(["DOCK"]);
    expect(template!.steps[0]!.resolved_params).toEqual({ x: 2.5, y: 1.25, theta: 90 });
  });
});
