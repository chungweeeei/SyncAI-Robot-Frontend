import { describe, expect, it } from "vitest";

import {
  PREVIEW_INSET,
  WAYPOINT_HIT_PX,
  planCaptions,
  previewView,
  waypointAt,
} from "@/lib/map/preview";
import { vertexScreen } from "@/lib/map/draw";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

/**
 * The rules the floor plan preview's hit test has to keep. A click on the
 * preview is the operator saying "that one", and these pin down what "that"
 * resolves to: the nearest dot within reach, in the same frame the markers
 * were drawn in.
 */

const meta: MapMetadata = {
  resolution: 0.05,
  origin: [-12.3, -7.8, 0],
  width: 400,
  height: 300,
};

// A wide preview: 320x160 against a 4:3 map fits by height, so the map is
// centred with a well on either side — the case where a naive x/width scale
// would be wrong.
const rect = { width: 320, height: 160 };
const view = previewView(rect, meta);

function stop(over: Partial<MapVertex>): MapVertex {
  return {
    id: "v",
    name: "v",
    type: "GENERAL",
    map_name: "dp2f",
    x: 0,
    y: 0,
    theta: 0,
    ...over,
  };
}

const dock = stop({ id: "dock", name: "dock", x: 2.5, y: 1.25 });
const room = stop({ id: "room", name: "room-a", x: -3, y: 4 });

describe("previewView", () => {
  it("fits the whole map inside the inset, centred", () => {
    const innerW = 320 - PREVIEW_INSET.left - PREVIEW_INSET.right;
    const innerH = 160 - PREVIEW_INSET.top - PREVIEW_INSET.bottom;
    // 300 rows into the inset height is the tighter side.
    const scale = innerH / 300;
    expect(view.scale).toBeCloseTo(scale);
    expect(view.oy).toBeCloseTo(PREVIEW_INSET.top);
    // 400 cols at that scale leave a well split evenly inside the inset.
    expect(view.ox).toBeCloseTo(PREVIEW_INSET.left + (innerW - 400 * scale) / 2);
  });

  it("keeps a stop on the map's edge clear of the canvas edge", () => {
    // The right and top need the most room: that is where a caption goes.
    const corner = stop({
      x: meta.origin[0] + meta.width * meta.resolution,
      y: meta.origin[1] + meta.height * meta.resolution,
    });
    const at = vertexScreen(view, meta, corner.x, corner.y);
    expect(rect.width - at.cx).toBeGreaterThanOrEqual(PREVIEW_INSET.right);
    expect(at.cy).toBeGreaterThanOrEqual(PREVIEW_INSET.top);
  });
});

describe("waypointAt", () => {
  it("returns the stop whose dot is under the pointer", () => {
    const at = vertexScreen(view, meta, dock.x, dock.y);
    expect(waypointAt(view, meta, [dock, room], at.cx, at.cy)).toBe(dock);
  });

  it("reaches to the hit radius and no further", () => {
    const at = vertexScreen(view, meta, dock.x, dock.y);
    expect(
      waypointAt(view, meta, [dock], at.cx + WAYPOINT_HIT_PX, at.cy),
    ).toBe(dock);
    expect(
      waypointAt(view, meta, [dock], at.cx + WAYPOINT_HIT_PX + 0.5, at.cy),
    ).toBeNull();
  });

  it("picks the nearer of two stops whose hit discs overlap", () => {
    // Two stops 6 cells (0.3 m) apart: at preview scale that is ~3 px, well
    // inside one hit radius, so both discs cover the midpoint.
    const near = stop({ id: "near", x: 2.5, y: 1.25 });
    const far = stop({ id: "far", x: 2.8, y: 1.25 });
    const a = vertexScreen(view, meta, near.x, near.y);
    const b = vertexScreen(view, meta, far.x, far.y);
    expect(waypointAt(view, meta, [far, near], a.cx + 1, a.cy)).toBe(near);
    expect(waypointAt(view, meta, [far, near], b.cx + 1, b.cy)).toBe(far);
  });

  it("uses the drawn frame: a larger map y lands nearer the top of the canvas", () => {
    // The y flip lives in worldToGrid. If the hit test ever derived its own
    // transform without it, a click on the upper stop would resolve to the
    // lower one.
    const low = stop({ id: "low", x: 0, y: 0 });
    const high = stop({ id: "high", x: 0, y: 5 });
    const atHigh = vertexScreen(view, meta, high.x, high.y);
    const atLow = vertexScreen(view, meta, low.x, low.y);
    expect(atHigh.cy).toBeLessThan(atLow.cy);
    expect(waypointAt(view, meta, [low, high], atHigh.cx, atHigh.cy)).toBe(high);
  });

  it("returns null with nothing in reach", () => {
    expect(waypointAt(view, meta, [dock, room], 0, 0)).toBeNull();
    expect(waypointAt(view, meta, [], 100, 80)).toBeNull();
  });
});

describe("planCaptions", () => {
  // Seven px a character, like a monospace caption at 11 px.
  const measure = (text: string) => text.length * 7;
  const at = (id: string, cx: number, cy: number) => ({ id, cx, cy, caption: `G · ${id}` });

  it("keeps every caption when none touch", () => {
    const kept = planCaptions([at("a", 10, 10), at("b", 10, 60), at("c", 120, 10)], measure);
    expect([...kept]).toEqual(["a", "b", "c"]);
  });

  it("drops a caption that would sit on one already placed, in priority order", () => {
    // Two stops three pixels apart: the first in the list is the lit one and
    // keeps its name; the second falls back to its glyph rather than smear it.
    const kept = planCaptions([at("lit", 10, 10), at("near", 13, 12)], measure);
    expect(kept.has("lit")).toBe(true);
    expect(kept.has("near")).toBe(false);
  });

  it("lets a third stop keep its name once the collision is out of its way", () => {
    // `near` lost its caption, so it takes no room: `next` only has to clear
    // `lit`, and it does.
    const kept = planCaptions(
      [at("lit", 10, 10), at("near", 13, 12), at("next", 10, 30)],
      measure,
    );
    expect([...kept]).toEqual(["lit", "next"]);
  });
});
