import { describe, expect, it } from "vitest";

import { drawSwatch, editStateOf, isPaintKind } from "@/lib/map/editor";
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

  it("puts a zone in zone mode and leaves the paint byte alone", () => {
    const state = editStateOf("zone");
    expect(state.mode).toBe("zone");
    expect(state.value).toBeUndefined();
    expect(state.panOnly).toBe(false);
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

describe("isPaintKind", () => {
  it("is true of the kinds with a byte, and of nothing else", () => {
    // The toolbar shows a swatch and the brush tools on this answer alone.
    for (const kind of ["wall", "floor", "unknown"] as const) {
      expect(isPaintKind(kind)).toBe(true);
    }
    expect(isPaintKind("waypoint")).toBe(false);
    expect(isPaintKind("zone")).toBe(false);
    expect(isPaintKind(null)).toBe(false);
  });
});

describe("drawSwatch", () => {
  it("is the byte the cell is drawn in, as a grey", () => {
    expect(drawSwatch("wall")).toBe(`rgb(${OCCUPIED} ${OCCUPIED} ${OCCUPIED})`);
    expect(drawSwatch("floor")).toBe(`rgb(${FREE} ${FREE} ${FREE})`);
  });
});
