import { describe, expect, it } from "vitest";

import { editBytes, remapWaypointIds, type EditorEdit } from "@/lib/map/history";
import { createUndoStack, popRedo, popUndo, pushPatch } from "@/lib/map/patch";
import { localVertexId } from "@/lib/map/vertex-stage";
import type { MapVertex } from "@/lib/types/map";

/**
 * The rules the editor's shared history has to keep: strokes and waypoint
 * edits come back in the order they were made, and a save does not leave the
 * history holding ids the robot has since replaced.
 */

const row = (id: string, name = id): MapVertex => ({
  id,
  name,
  type: "GENERAL",
  map_name: "dp2f",
  x: 0,
  y: 0,
  theta: 0,
});

const grid = (): EditorEdit => ({
  kind: "grid",
  patch: {
    cells: new Uint32Array([0]),
    before: new Uint8Array([0]),
    after: new Uint8Array([254]),
    bounds: { col: 0, row: 0, w: 1, h: 1 },
  },
});

describe("the editor's history", () => {
  it("steps back over a stroke and a waypoint edit in the order they were made", () => {
    const stack = createUndoStack<EditorEdit>(editBytes);
    const stroke = grid();
    const placed: EditorEdit = { kind: "waypoints", before: [], after: [row("a")] };
    pushPatch(stack, stroke);
    pushPatch(stack, placed);

    expect(popUndo(stack)).toBe(placed);
    expect(popUndo(stack)).toBe(stroke);
    expect(popRedo(stack)).toBe(stroke);
  });

  it("weighs a waypoint edit, so the byte budget still counts it", () => {
    expect(editBytes({ kind: "waypoints", before: [row("a")], after: [] })).toBeGreaterThan(0);
  });
});

describe("remapWaypointIds", () => {
  it("swaps a saved waypoint's local id everywhere the history holds it", () => {
    const local = localVertexId(1);
    const stack = createUndoStack<EditorEdit>(editBytes);
    pushPatch(stack, { kind: "waypoints", before: [], after: [row(local, "door")] });
    pushPatch(stack, {
      kind: "waypoints",
      before: [row(local, "door")],
      after: [row(local, "front-door")],
    });
    popUndo(stack);

    remapWaypointIds(stack, new Map([[local, "server-id"]]));

    const ids = [...stack.undo, ...stack.redo].flatMap((edit) =>
      edit.kind === "waypoints" ? [...edit.before, ...edit.after].map((v) => v.id) : [],
    );
    expect(ids).toEqual(["server-id", "server-id", "server-id"]);
  });

  it("leaves strokes and other waypoints alone", () => {
    const stack = createUndoStack<EditorEdit>(editBytes);
    const stroke = grid();
    pushPatch(stack, stroke);
    pushPatch(stack, { kind: "waypoints", before: [], after: [row("kept")] });

    remapWaypointIds(stack, new Map([[localVertexId(9), "server-id"]]));

    expect(stack.undo[0]).toBe(stroke);
    expect(stack.undo[1]).toEqual({ kind: "waypoints", before: [], after: [row("kept")] });
  });
});
