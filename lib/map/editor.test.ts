import { describe, expect, it } from "vitest";

import { drawSwatch, editStateOf } from "@/lib/map/editor";
import { FREE, OCCUPIED, UNKNOWN } from "@/lib/map/grid";

describe("editStateOf", () => {
  it("paints the byte each kind is named for", () => {
    // Wall is what the planner treats as an obstacle, Floor what it treats as
    // free: a swapped pair here would paint walls where the operator erased
    // them, and nothing on screen would say so until the robot refused a route.
    expect(editStateOf("wall")).toEqual({ mode: "grid", value: OCCUPIED, panOnly: false });
    expect(editStateOf("floor")).toEqual({ mode: "grid", value: FREE, panOnly: false });
    expect(editStateOf("unknown")).toEqual({ mode: "grid", value: UNKNOWN, panOnly: false });
  });

  it("puts waypoints in vertex mode and leaves the paint byte alone", () => {
    const state = editStateOf("waypoint");
    expect(state.mode).toBe("vertex");
    expect(state.value).toBeUndefined();
  });

  it("offers nothing but Pan when nothing is chosen", () => {
    // The resting state the editor opens in: a press may only move the view.
    expect(editStateOf(null)).toEqual({ mode: "grid", panOnly: true });
  });

  it("never lets a paint kind land in vertex mode", () => {
    for (const kind of ["wall", "floor", "unknown"] as const) {
      expect(editStateOf(kind).mode).toBe("grid");
    }
  });
});

describe("drawSwatch", () => {
  it("is the byte the cell is drawn in, as a grey", () => {
    expect(drawSwatch("wall")).toBe(`rgb(${OCCUPIED} ${OCCUPIED} ${OCCUPIED})`);
    expect(drawSwatch("floor")).toBe(`rgb(${FREE} ${FREE} ${FREE})`);
  });
});
