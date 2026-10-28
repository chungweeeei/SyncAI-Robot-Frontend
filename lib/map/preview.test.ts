import { describe, expect, it } from "vitest";

import {
  CHEVRON_MIN_LEG_PX,
  LANE_PX,
  legHasChevron,
  planCaptions,
  planLegs,
} from "@/lib/map/preview";

/**
 * The rule the route map's captions keep: captions that would smear give way
 * in a known order, the job's stops first.
 */

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

/**
 * The rules the route's legs keep: a walk back is not drawn over the walk
 * out, and no leg is drawn that the robot will not walk.
 */
describe("planLegs", () => {
  // A on the left, B to its right, C below B; screen y grows downward.
  const placed = new Map([
    ["a", { cx: 0, cy: 0 }],
    ["b", { cx: 100, cy: 0 }],
    ["c", { cx: 100, cy: 100 }],
  ]);
  const route = (...ids: string[]) => ids.map((vertexId, key) => ({ key, vertexId }));

  it("keeps each leg to the right of its walk", () => {
    // Walking right along the screen, right of travel is down the screen.
    const [leg] = planLegs(route("a", "b"), placed);
    expect(leg).toMatchObject({ x0: 0, y0: LANE_PX, x1: 100, y1: LANE_PX, lane: 0 });
  });

  it("draws a walk back on the other side of the walk out", () => {
    const legs = planLegs(route("a", "b", "c", "b"), placed);
    const out = legs[1]!;
    const back = legs[2]!;
    // B → C runs down the screen at x = 100; its right is the left of the screen.
    expect(out.x0).toBeLessThan(100);
    expect(back.x0).toBeGreaterThan(100);
    expect(back.lane).toBe(0);
  });

  it("puts a walk repeated the same way in the next lane out", () => {
    const legs = planLegs(route("a", "b", "a", "b"), placed);
    expect(legs.map((leg) => leg.lane)).toEqual([0, 0, 1]);
    expect(legs[2]!.y0).toBe(LANE_PX * 2);
  });

  it("names each leg by the stop it walks to", () => {
    const legs = planLegs(route("a", "b", "c", "b"), placed);
    expect(legs.map((leg) => leg.arrive)).toEqual([1, 2, 3]);
  });

  it("draws no leg across a stop that is not on screen", () => {
    // B on another floor: A → B → C is not a walk from A to C.
    const shown = new Map([...placed].filter(([id]) => id !== "b"));
    expect(planLegs(route("a", "b", "c"), shown)).toEqual([]);
  });

  it("draws no leg between two stops on the same pixel", () => {
    const stacked = new Map([...placed, ["d", { cx: 0, cy: 0 }]]);
    expect(planLegs(route("a", "d"), stacked)).toEqual([]);
  });

  it("leaves the chevron off a leg too short to hold it", () => {
    const near = new Map([
      ["a", { cx: 0, cy: 0 }],
      ["b", { cx: CHEVRON_MIN_LEG_PX - 1, cy: 0 }],
      ["c", { cx: CHEVRON_MIN_LEG_PX - 1, cy: 200 }],
    ]);
    const [short, long] = planLegs(route("a", "b", "c"), near);
    expect(legHasChevron(short!)).toBe(false);
    expect(legHasChevron(long!)).toBe(true);
  });
});
