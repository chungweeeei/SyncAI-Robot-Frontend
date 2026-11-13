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

const CHARGE = {
  id: "1-charge",
  type: "CHARGE",
  vertex_id: "11111111-1111-1111-1111-111111111111",
  vertex_name: "charger",
  vertex_status: "CURRENT",
  group: null,
  params: { x: 2.5, y: 1.25, theta: 90 },
  resolved_params: { x: 2.5, y: 1.25, theta: 90 },
};

describe("listTaskTemplates", () => {
  it("reads a Charge with its waypoint and pose", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: "t1",
            name: "charge",
            description: "",
            map_name: "wh1",
            steps: [CHARGE],
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
    expect(template!.steps.map((step) => step.type)).toEqual(["CHARGE"]);
    expect(template!.steps[0]!.resolved_params).toEqual({ x: 2.5, y: 1.25, theta: 90 });
  });

  function answer(steps: unknown[]) {
    return new Response(
      JSON.stringify([
        {
          id: "t2",
          name: "round",
          description: "",
          map_name: "wh1",
          steps,
          map_matches_active: true,
          missing_vertex_count: 1,
          created_at: "2026-11-01T00:00:00Z",
          updated_at: "2026-11-01T00:00:00Z",
        },
      ]),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const PATROL = {
    id: "1-patrol",
    type: "PATROL",
    group: null,
    params: {
      waypoints: [
        { x: 0, y: 0, theta: 0, z: 0 },
        { x: 1, y: 1, theta: 0, z: 0 },
      ],
    },
    resolved_params: {
      waypoints: [
        { x: 0.5, y: 0, theta: 0, z: 0 },
        { x: 1, y: 1, theta: 90, z: 0 },
      ],
    },
    vertex_ids: ["11111111-1111-1111-1111-111111111111", null],
    vertex_names: ["lobby", null],
    vertex_statuses: ["CURRENT", "NONE"],
  };

  it("reads a Patrol with each waypoint's vertex, name and status", async () => {
    fetchMock.mockResolvedValue(
      answer([{ ...PATROL, vertex_id: null, vertex_name: null, vertex_status: "NONE" }]),
    );
    const [template] = await listTaskTemplates();
    const [step] = template!.steps;
    expect(step).toMatchObject({
      type: "PATROL",
      vertex_ids: PATROL.vertex_ids,
      vertex_names: ["lobby", null],
      vertex_statuses: ["CURRENT", "NONE"],
      resolved_params: PATROL.resolved_params,
    });
  });

  // The singular three are MOVE's: a backend that leaves them off a PATROL
  // must not cost the whole library.
  it("reads a Patrol that carries none of the single vertex keys", async () => {
    fetchMock.mockResolvedValue(answer([PATROL]));
    const [template] = await listTaskTemplates();
    expect(template!.steps[0]).toMatchObject({
      type: "PATROL",
      vertex_id: null,
      vertex_name: null,
      vertex_status: "NONE",
    });
  });
});
