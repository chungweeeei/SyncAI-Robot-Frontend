import { describe, expect, it } from "vitest";

import {
  isLocalVertex,
  localVertexId,
  planVertexSave,
  rebaseVertices,
  sameVertices,
  vertexSaveFailure,
  vertexSaveSummary,
} from "@/lib/map/vertex-stage";
import type { MapVertex } from "@/lib/types/map";

/**
 * The rules staged waypoints have to keep. Each is something the robot would
 * otherwise feel: a request for a change the operator took back, a stored row
 * deleted because a local one was, a failed write marked saved.
 */

const row = (id: string, over: Partial<MapVertex> = {}): MapVertex => ({
  id,
  name: id,
  type: "GENERAL",
  map_name: "dp2f",
  x: 1,
  y: 2,
  theta: 0,
  ...over,
});

describe("local ids", () => {
  it("are never mistaken for a row the robot issued", () => {
    expect(isLocalVertex(localVertexId(1))).toBe(true);
    expect(isLocalVertex("11111111-1111-1111-1111-111111111111")).toBe(false);
  });
});

describe("planVertexSave", () => {
  it("sends nothing for an edit that was taken back", () => {
    const saved = [row("a")];
    const renamed = [row("a", { name: "dock" })];
    expect(sameVertices(saved, renamed)).toBe(false);
    expect(sameVertices(saved, [row("a", { name: "a" })])).toBe(true);
  });

  it("sends nothing for a waypoint placed and removed before Save", () => {
    const saved = [row("a")];
    // Placed, then deleted again: the working list is back to what was loaded.
    expect(planVertexSave(saved, [row("a")])).toEqual({
      deletes: [],
      updates: [],
      creates: [],
    });
  });

  it("puts only the fields that moved in an update", () => {
    const plan = planVertexSave([row("a")], [row("a", { type: "CHARGER" })]);
    expect(plan.updates).toEqual([{ id: "a", changes: { type: "CHARGER" } }]);
  });

  it("reads -180 and 180 as one heading, since the backend stores one", () => {
    const plan = planVertexSave([row("a", { theta: 180 })], [row("a", { theta: -180 })]);
    expect(plan.updates).toEqual([]);
  });

  it("folds a staged heading before it is sent", () => {
    const local = row(localVertexId(1), { theta: 270 });
    const plan = planVertexSave([], [local]);
    expect(plan.creates).toEqual([
      { localId: local.id, draft: { name: local.name, type: "GENERAL", x: 1, y: 2, theta: -90 } },
    ]);
  });

  it("deletes a stored row that left the screen, and nothing else", () => {
    const plan = planVertexSave([row("a"), row("b")], [row("b")]);
    expect(plan.deletes).toEqual(["a"]);
    expect(plan.updates).toEqual([]);
    expect(plan.creates).toEqual([]);
  });
});

describe("the save note", () => {
  const none = { deleted: [], updated: [], created: [] };

  it("leaves the backend's sentence as it was when nothing landed", () => {
    expect(vertexSaveFailure(none, "Name already in use.")).toBe("Name already in use.");
  });

  it("says what landed before a refusal, ahead of the backend's sentence", () => {
    const message = vertexSaveFailure({ ...none, deleted: ["a", "b"] }, "Name already in use.");
    expect(message).toMatch(/^Saved first: 2 deleted\./);
    expect(message.endsWith("Name already in use.")).toBe(true);
  });

  it("counts only the kinds that happened", () => {
    expect(vertexSaveSummary({ ...none, created: [{ localId: "local:1", vertex: row("x") }] })).toBe(
      "1 added",
    );
  });
});

describe("rebaseVertices", () => {
  it("keeps what did not land unsaved, so Save stays lit for the retry", () => {
    const saved = [row("a"), row("b")];
    const local = row(localVertexId(1), { name: "new" });
    const working = [row("a", { name: "renamed" }), local];
    // The delete of b landed; the rename of a failed, so nothing after it went.
    const next = rebaseVertices(saved, working, { deleted: ["b"], updated: [], created: [] });
    expect(next.saved).toEqual([row("a")]);
    expect(planVertexSave(next.saved, next.working)).toEqual({
      deletes: [],
      updates: [{ id: "a", changes: { name: "renamed" } }],
      creates: [{ localId: local.id, draft: expect.objectContaining({ name: "new" }) }],
    });
  });

  it("gives a created row the robot's id, and says which it replaced", () => {
    const local = row(localVertexId(3), { name: "door" });
    const echo = row("server-id", { name: "door" });
    const next = rebaseVertices([], [local], {
      deleted: [],
      updated: [],
      created: [{ localId: local.id, vertex: echo }],
    });
    expect(next.working.map((vertex) => vertex.id)).toEqual(["server-id"]);
    expect(next.ids.get(local.id)).toBe("server-id");
    expect(sameVertices(next.saved, next.working)).toBe(true);
  });

  it("keeps an edit made while the save was in flight", () => {
    const local = row(localVertexId(1), { name: "door" });
    // Renamed on screen after the create was sent with "door".
    const edited = { ...local, name: "front-door" };
    const next = rebaseVertices([], [edited], {
      deleted: [],
      updated: [],
      created: [{ localId: local.id, vertex: row("server-id", { name: "door" }) }],
    });
    expect(planVertexSave(next.saved, next.working).updates).toEqual([
      { id: "server-id", changes: { name: "front-door" } },
    ]);
  });
});
