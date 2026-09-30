import { describe, expect, it } from "vitest";

import {
  MIN_ZONE_POINTS,
  canCloseZone,
  classifyZonePress,
  cornerAt,
  mergeIntoZone,
  newZoneId,
  pointInPolygon,
  reshapeZone,
  zoneAt,
  type ZonePoint,
  type ZonePressInput,
} from "@/lib/map/zone";

/**
 * The rules a forbidden zone has to keep. Each is something the operator
 * would otherwise feel: a shape that closed into a line, a press on the first
 * corner that added a corner instead, a finger that could not hit the dot.
 */

const points = (n: number): ZonePoint[] =>
  Array.from({ length: n }, (_, i) => ({ x: i, y: i * 2 }));

describe("canCloseZone", () => {
  it("needs three corners before a shape can close", () => {
    // Two points are a line, which has no inside to keep the robot out of.
    expect(canCloseZone(points(2))).toBe(false);
    expect(canCloseZone(points(3))).toBe(true);
    expect(MIN_ZONE_POINTS).toBe(3);
  });
});

describe("cornerAt", () => {
  const corners = [
    { cx: 100, cy: 100 },
    { cx: 160, cy: 100 },
    { cx: 108, cy: 100 },
  ];

  it("finds the corner under the press, and none on bare map", () => {
    expect(cornerAt(corners, { cx: 160, cy: 104 }, 11)).toBe(1);
    expect(cornerAt(corners, { cx: 130, cy: 100 }, 11)).toBeNull();
    expect(cornerAt([], { cx: 100, cy: 100 }, 11)).toBeNull();
  });

  it("widens the target to the finger, edge included", () => {
    // 15 px off the dot: outside a mouse's 11 px slop, inside a finger's 22 px.
    const off = { cx: 175, cy: 100 };
    expect(cornerAt(corners, off, 11)).toBeNull();
    expect(cornerAt(corners, off, 22)).toBe(1);
    expect(cornerAt(corners, { cx: 171, cy: 100 }, 11)).toBe(1);
  });

  it("picks the nearest where two dots overlap", () => {
    // The first and third are 8 px apart, both inside either press's slop: a
    // corner dropped almost on the first can still be picked back up.
    expect(cornerAt(corners, { cx: 101, cy: 100 }, 11)).toBe(0);
    expect(cornerAt(corners, { cx: 107, cy: 100 }, 11)).toBe(2);
  });
});

describe("classifyZonePress", () => {
  const press = (over: Partial<ZonePressInput> = {}): ZonePressInput => ({
    count: 3,
    anchored: false,
    corner: null,
    onZone: false,
    onHandle: false,
    ...over,
  });

  it("adds the first corner when nothing is placed", () => {
    expect(classifyZonePress(press({ count: 0 }))).toBe("add");
  });

  it("adds a corner on bare map", () => {
    expect(classifyZonePress(press({ corner: null }))).toBe("add");
  });

  it("closes on the first corner only once there are three, and adds nothing before", () => {
    // A second corner on top of the first would be an edge that can never close.
    expect(classifyZonePress(press({ count: 2, corner: 0 }))).toBe("ignore");
    expect(classifyZonePress(press({ count: 3, corner: 0 }))).toBe("close");
    expect(classifyZonePress(press({ count: 5, corner: 0 }))).toBe("close");
  });

  it("never adds a corner on top of a later one", () => {
    // The press is kept for a drag, which moves the corner; a click there
    // would otherwise stack a fifth dot the shape counts and the eye cannot.
    expect(classifyZonePress(press({ count: 3, corner: 1 }))).toBe("ignore");
    expect(classifyZonePress(press({ count: 5, corner: 4 }))).toBe("ignore");
  });

  it("starts an anchored shape on a finished zone's corner", () => {
    // Neither a first corner of its own nor a re-selection: the handle may
    // sit a hair outside the polygon, and "add" there would start a shape
    // that is not attached to anything.
    expect(classifyZonePress(press({ count: 0, onHandle: true }))).toBe("anchor");
    expect(classifyZonePress(press({ count: 0, onHandle: true, onZone: true }))).toBe("anchor");
  });

  it("merges an anchored shape on another corner of its zone, once it has a corner of its own", () => {
    // Anchor and target alone would only straighten an edge, which is a
    // corner drag's job.
    expect(classifyZonePress(press({ count: 1, anchored: true, onHandle: true }))).toBe("ignore");
    expect(classifyZonePress(press({ count: 2, anchored: true, onHandle: true }))).toBe("merge");
    // Bare map is still the next corner.
    expect(classifyZonePress(press({ count: 2, anchored: true }))).toBe("add");
  });

  it("anchors a shape under way that reaches a zone's corner", () => {
    // Started on bare map and closed onto a zone: the corner it reaches is
    // where it attaches, and the corners drawn so far are the run.
    expect(classifyZonePress(press({ count: 2, anchored: false, onHandle: true }))).toBe("anchor");
  });

  it("never closes an anchored shape on its own first corner", () => {
    // Its first corner is the zone's; only a corner of the zone ends it.
    expect(classifyZonePress(press({ count: 4, anchored: true, corner: 0 }))).toBe("ignore");
  });

  it("selects a finished zone only while no shape is in flight", () => {
    // Once a corner is down, a press inside a zone is the next corner, so a
    // shape can still be drawn across one that is already there.
    expect(classifyZonePress(press({ count: 0, onZone: true }))).toBe("select");
    expect(classifyZonePress(press({ count: 1, onZone: true }))).toBe("add");
  });
});

describe("pointInPolygon", () => {
  const square: ZonePoint[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it("is inside within the edges and outside beyond them", () => {
    expect(pointInPolygon(square, { x: 1, y: 1 })).toBe(true);
    expect(pointInPolygon(square, { x: 3, y: 1 })).toBe(false);
    expect(pointInPolygon(square, { x: 1, y: -1 })).toBe(false);
  });

  it("reads a concave shape by its edges, not its hull", () => {
    // An L: the notch at top-right is outside even though the hull covers it.
    const ell: ZonePoint[] = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 2 },
      { x: 0, y: 2 },
    ];
    expect(pointInPolygon(ell, { x: 1.5, y: 1.5 })).toBe(false);
    expect(pointInPolygon(ell, { x: 0.5, y: 1.5 })).toBe(true);
  });
});

describe("zoneAt", () => {
  it("picks the zone drawn last where two overlap, and none on bare map", () => {
    const under = { id: "under", points: points(0).concat([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }, { x: 0, y: 4 }]) };
    const over = { id: "over", points: [{ x: 1, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 3 }, { x: 1, y: 3 }] };
    expect(zoneAt([under, over], { x: 2, y: 2 })?.id).toBe("over");
    expect(zoneAt([under, over], { x: 0.5, y: 0.5 })?.id).toBe("under");
    expect(zoneAt([under, over], { x: 9, y: 9 })).toBeNull();
  });
});

describe("reshapeZone", () => {
  // A unit square, corners clockwise from the origin on screen: A B C D.
  const square: ZonePoint[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];

  it("replaces the edge between the two corners with the run, keeping the larger zone", () => {
    // A bump drawn outward off the right edge, from B to C: the square grows,
    // and the corners bypassed are none — the edge B→C itself goes.
    const bump = [
      { x: 3, y: 0.5 },
      { x: 3, y: 1.5 },
    ];
    expect(reshapeZone(square, 1, 2, bump)).toEqual([
      { x: 3, y: 0.5 },
      { x: 3, y: 1.5 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 0 },
      { x: 2, y: 0 },
    ]);
  });

  it("reads the same bump the same way from either corner", () => {
    // Drawn C→B instead: the run arrives reversed, and the result is the
    // same ring, so which corner the operator happened to start at cannot
    // change the shape.
    const bump = [
      { x: 3, y: 1.5 },
      { x: 3, y: 0.5 },
    ];
    const ring = reshapeZone(square, 2, 1, bump);
    expect(ring).toHaveLength(6);
    for (const point of [...square, ...bump]) expect(ring).toContainEqual(point);
  });

  it("cuts a notch when the run is drawn inward, keeping the larger piece", () => {
    // From A across to C through the middle: the two pieces are the
    // triangles A B C and A C D plus the notch; the larger survives.
    const notch = [{ x: 1.5, y: 0.5 }];
    const ring = reshapeZone(square, 0, 2, notch);
    // A → notch → C → D → A is 3.5 of the 4; the other way is 0.5.
    expect(ring).toEqual([
      { x: 1.5, y: 0.5 },
      { x: 2, y: 2 },
      { x: 0, y: 2 },
      { x: 0, y: 0 },
    ]);
  });

  it("leaves a zone alone when the corners are the same", () => {
    expect(reshapeZone(square, 1, 1, [{ x: 9, y: 9 }])).toEqual(square);
  });
});

describe("mergeIntoZone", () => {
  const square: ZonePoint[] = [
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
  ];
  const bump = [
    { x: 3, y: 0.5 },
    { x: 3, y: 1.5 },
  ];

  it("takes the corners after the anchor for a shape started on the zone", () => {
    // Started on B, two corners out, ending on C: the draft is B's copy then
    // the bump.
    const draft = [square[1], ...bump];
    expect(mergeIntoZone(square, draft, { index: 1, position: 0 }, 2)).toEqual(
      reshapeZone(square, 1, 2, bump),
    );
  });

  it("takes the corners before the anchor for a shape that reached the zone", () => {
    // Started on bare map with the bump, reached C, ending on B: the same
    // zone as the other way round — where the operator started cannot
    // change the shape.
    const draft = [...bump, square[2]];
    const ring = mergeIntoZone(square, draft, { index: 2, position: 2 }, 1);
    expect(ring).toHaveLength(6);
    for (const point of [...square, ...bump]) expect(ring).toContainEqual(point);
  });

  it("has nothing to merge without a corner of the shape's own, or onto the anchor", () => {
    expect(mergeIntoZone(square, [square[1]], { index: 1, position: 0 }, 2)).toBeNull();
    expect(mergeIntoZone(square, [square[1], ...bump], { index: 1, position: 0 }, 1)).toBeNull();
  });
});

describe("newZoneId", () => {
  it("never repeats within a session", () => {
    expect(newZoneId()).not.toBe(newZoneId());
  });
});
