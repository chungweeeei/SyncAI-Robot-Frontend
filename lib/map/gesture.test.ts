import { describe, expect, it } from "vitest";

import {
  DRAG_DEADZONE_PX,
  bandBetween,
  bandIsClick,
  classifyPress,
  headingDegrees,
  idsInBand,
  isDrag,
  panPicks,
  type PressInput,
} from "@/lib/map/gesture";

/**
 * The rules a press on the map has to keep. Each is something an operator
 * feels: a right-drag that paints instead of panning, a click that snaps a
 * waypoint's heading to 0°, a band that selects what it was not drawn around.
 */

const press = (over: Partial<PressInput> = {}): PressInput => ({
  button: 0,
  spacePan: false,
  shiftKey: false,
  touch: false,
  mode: "grid",
  tool: "brush",
  vertexTool: "place",
  onVertex: false,
  ...over,
});

describe("classifyPress", () => {
  it("pans on the right and middle buttons whatever is armed", () => {
    for (const button of [1, 2]) {
      expect(classifyPress(press({ button }))).toBe("pan");
      expect(classifyPress(press({ button, mode: "vertex", vertexTool: "place" }))).toBe("pan");
    }
  });

  it("pans on any button while Space is held", () => {
    expect(classifyPress(press({ spacePan: true }))).toBe("pan");
    expect(classifyPress(press({ spacePan: true, mode: "vertex", onVertex: true }))).toBe("pan");
  });

  it("pans on the left button only when the mode's own tool is Pan", () => {
    expect(classifyPress(press({ tool: "pan" }))).toBe("pan");
    expect(classifyPress(press({ mode: "vertex", vertexTool: "pan" }))).toBe("pan");
  });

  it("reads each mode's tool and ignores the other's", () => {
    // A brush armed in grid mode does not paint from waypoint mode, and Pan
    // armed for waypoints does not stop a grid stroke.
    expect(classifyPress(press({ mode: "vertex", tool: "brush", vertexTool: "place" }))).toBe("aim");
    expect(classifyPress(press({ mode: "grid", tool: "line", vertexTool: "pan" }))).toBe("stroke");
  });

  it("strokes with any armed grid tool", () => {
    for (const tool of ["brush", "line", "rect"] as const) {
      expect(classifyPress(press({ tool }))).toBe("stroke");
    }
  });

  it("toggles a marker on Shift with Select armed, and arms nothing", () => {
    expect(
      classifyPress(press({ mode: "vertex", vertexTool: "select", onVertex: true, shiftKey: true })),
    ).toBe("toggle");
  });

  it("toggles a marker on a bare tap with Select armed, since a finger has no Shift", () => {
    expect(
      classifyPress(press({ mode: "vertex", vertexTool: "select", onVertex: true, touch: true })),
    ).toBe("toggle");
    // A finger still re-aims under Pan and Place: only Select reads the tap as a toggle.
    expect(
      classifyPress(press({ mode: "vertex", vertexTool: "place", onVertex: true, touch: true })),
    ).toBe("aim");
  });

  it("starts a band on bare map with Select armed, with or without Shift", () => {
    for (const shiftKey of [false, true]) {
      expect(classifyPress(press({ mode: "vertex", vertexTool: "select", shiftKey }))).toBe("marquee");
    }
  });

  it("re-aims a pressed marker under either waypoint tool", () => {
    for (const vertexTool of ["place", "select"] as const) {
      expect(classifyPress(press({ mode: "vertex", vertexTool, onVertex: true }))).toBe("aim");
    }
  });

  it("places on bare map with Place armed", () => {
    expect(classifyPress(press({ mode: "vertex", vertexTool: "place" }))).toBe("aim");
  });
});

describe("panPicks", () => {
  it("picks only on a plain left press with Pan armed for waypoints", () => {
    expect(panPicks({ mode: "vertex", vertexTool: "pan", button: 0, spacePan: false })).toBe(true);
    expect(panPicks({ mode: "vertex", vertexTool: "pan", button: 2, spacePan: false })).toBe(false);
    expect(panPicks({ mode: "vertex", vertexTool: "pan", button: 0, spacePan: true })).toBe(false);
    expect(panPicks({ mode: "grid", vertexTool: "pan", button: 0, spacePan: false })).toBe(false);
    expect(panPicks({ mode: "vertex", vertexTool: "select", button: 0, spacePan: false })).toBe(false);
  });
});

describe("isDrag", () => {
  it("is a click inside the deadzone and a drag at its edge", () => {
    expect(isDrag(0, 0, DRAG_DEADZONE_PX - 1, 0)).toBe(false);
    expect(isDrag(0, 0, DRAG_DEADZONE_PX, 0)).toBe(true);
  });

  it("measures the straight-line distance, not each axis", () => {
    // 7 px on each axis is under 10 px either way but ~9.9 px across.
    expect(isDrag(0, 0, 7, 7)).toBe(false);
    expect(isDrag(0, 0, 8, 8)).toBe(true);
  });
});

describe("headingDegrees", () => {
  it("reads the map frame: +x is 0°, +y is 90°, counter-clockwise positive", () => {
    expect(headingDegrees(1, 0)).toBe(0);
    expect(headingDegrees(0, 1)).toBe(90);
    expect(headingDegrees(-1, 0)).toBe(180);
    expect(headingDegrees(0, -1)).toBe(-90);
  });

  it("has no answer for no displacement, rather than claiming 0°", () => {
    expect(headingDegrees(0, 0)).toBeNull();
  });

  it("gives the editor's upward drag 90° once screen y is flipped", () => {
    // Canvas rows grow downward, so a drag up the screen is a negative dy.
    const screenDy = -20;
    expect(headingDegrees(0, -screenDy)).toBe(90);
  });
});

describe("the rubber band", () => {
  it("is the same band whichever corner it was dragged from", () => {
    expect(bandBetween(50, 60, 10, 20)).toEqual(bandBetween(10, 20, 50, 60));
  });

  it("is a click only when both sides stayed inside the deadzone", () => {
    expect(bandIsClick(bandBetween(0, 0, 5, 5))).toBe(true);
    // A long thin band is a real selection of the markers along it.
    expect(bandIsClick(bandBetween(0, 0, 200, 3))).toBe(false);
  });

  it("selects the markers whose centres are inside it, edges included", () => {
    const band = bandBetween(10, 10, 100, 100);
    const markers = [
      { id: "inside", cx: 50, cy: 50 },
      { id: "edge", cx: 100, cy: 10 },
      { id: "outside", cx: 101, cy: 50 },
    ];
    expect(idsInBand(band, markers)).toEqual(["inside", "edge"]);
  });
});
