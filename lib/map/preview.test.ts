import { describe, expect, it } from "vitest";

import { PREVIEW_INSET, planCaptions, previewView, stopCaption } from "@/lib/map/preview";
import { VERTEX_HIT_RADIUS, vertexAt, vertexScreen } from "@/lib/map/draw";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

/**
 * The rules the floor plan preview has to keep: the view it opens at leaves
 * room for the marks on the map's edge, a lit stop says which steps go to it,
 * and captions that would smear give way in a known order.
 */

const meta: MapMetadata = {
  resolution: 0.05,
  origin: [-12.3, -7.8, 0],
  width: 400,
  height: 300,
};

// A wide preview: a 4:3 map fits by height, with a well either side, where a
// naive x/width scale would be wrong.
const rect = { width: 320, height: 160 };
const view = previewView(rect, meta);

function stop(over: Partial<MapVertex>): MapVertex {
  return {
    id: "v",
    name: "v",
    type: "MOVE",
    map_name: "dp2f",
    x: 0,
    y: 0,
    theta: 0,
    z: 0,
    ...over,
  };
}

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

describe("stopCaption", () => {
  it("names the stop, or the stops, that go to a waypoint", () => {
    expect(stopCaption("dock", [2])).toBe("dock · stop 2");
    // A patrol that returns: one marker, every visit, in job order.
    expect(stopCaption("dock", [1, 4])).toBe("dock · stops 1, 4");
  });

  it("is just the name for a waypoint the job does not visit", () => {
    expect(stopCaption("room-a", [])).toBe("room-a");
  });
});

describe("vertexAt", () => {
  const a = stop({ id: "a", x: 0, y: 0 });
  const b = stop({ id: "b", x: 0.05, y: 0 });
  const at = vertexScreen(view, meta, 0, 0);

  it("finds a stop within the slop and nothing outside it", () => {
    expect(vertexAt(view, meta, [a], at.cx + 5, at.cy, VERTEX_HIT_RADIUS)?.id).toBe("a");
    expect(vertexAt(view, meta, [a], at.cx + VERTEX_HIT_RADIUS + 1, at.cy, VERTEX_HIT_RADIUS)).toBeNull();
  });

  it("picks the one drawn on top where two overlap", () => {
    // Drawn in list order, so the last is the one the pointer sees.
    expect(vertexAt(view, meta, [a, b], at.cx, at.cy, VERTEX_HIT_RADIUS)?.id).toBe("b");
  });
});
