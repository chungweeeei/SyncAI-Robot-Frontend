import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { GROUND_FLOOR_Z_M } from "@/lib/map/floors";
import {
  arrowStations,
  createDashedRibbon,
  createPathRibbon,
  dashPieces,
} from "@/lib/scene/path-ribbon";
import { THEMES } from "@/lib/scene/theme";

/** A route as the telemetry stream hands it over: flat [x, y, z] triples. */
const route = (...points: [number, number, number][]) => Float32Array.from(points.flat());

/** Ground floor, a stair, the floor three metres up. */
const upTheStair = route([0, 0, 0], [1, 0, 0], [2, 0, 1.5], [3, 0, 3], [4, 0, 3]);

const heightsOf = (ribbon: NonNullable<ReturnType<typeof createPathRibbon>>) => {
  const position = ribbon.mesh.geometry.getAttribute("position");
  return Array.from({ length: position.count }, (_, i) => +position.getZ(i).toFixed(3));
};

/** The ground floor's band, just over its ground. */
const onGround = +(GROUND_FLOOR_Z_M + 0.012).toFixed(3);

/** How many segments are drawn: two triangles, six indices, each. */
const segmentsOf = (ribbon: NonNullable<ReturnType<typeof createPathRibbon>>) =>
  ribbon.mesh.geometry.getIndex()!.count / 6;

describe("createPathRibbon", () => {
  it("lays each stretch on its own ground, just over it", () => {
    const ribbon = createPathRibbon(upTheStair, THEMES.light)!;
    // Two vertices per point, both at the point's ground plus the lift; the
    // ground floor's 0 is its real ground.
    expect(heightsOf(ribbon)).toEqual([
      onGround, onGround, onGround, onGround, 1.512, 1.512, 3.012, 3.012, 3.012, 3.012,
    ]);
    expect(segmentsOf(ribbon)).toBe(4);
  });

  it("never goes under the ground floor", () => {
    // A planner's ground a few centimetres under the ground floor is still
    // the ground floor; under it, the route would be hidden.
    const under = GROUND_FLOOR_Z_M - 0.05;
    const ribbon = createPathRibbon(route([0, 0, under], [1, 0, under]), THEMES.light)!;
    expect(heightsOf(ribbon).every((z) => z === onGround)).toBe(true);
  });

  it("follows a ground well under the ground floor down to it", () => {
    // A site mapped from the top of a slope: lifted onto the ground floor,
    // this route floated 1.5 m over the ground it crosses.
    const ribbon = createPathRibbon(route([0, 0, -1.0], [1, 0, -2.0]), THEMES.light)!;
    expect(heightsOf(ribbon)).toEqual([-0.988, -0.988, -1.988, -1.988]);
  });

  it("draws only the floor shown, and the whole route again with none", () => {
    const ribbon = createPathRibbon(upTheStair, THEMES.light)!;

    ribbon.setBand(-Infinity, 1.0); // the ground floor: its one segment
    expect(segmentsOf(ribbon)).toBe(1);

    ribbon.setBand(2.0, 4.5); // upstairs: its one segment
    expect(segmentsOf(ribbon)).toBe(1);

    ribbon.setBand(5.0, 8.0); // a floor the route never reaches
    expect(segmentsOf(ribbon)).toBe(0);

    ribbon.setBand(-Infinity, Infinity);
    expect(segmentsOf(ribbon)).toBe(4);
  });

  it("drops a segment with one end off the floor shown", () => {
    // The stair's middle point is on neither floor's band here, so neither
    // segment touching it is drawn — not half a stair hanging off a floor.
    const ribbon = createPathRibbon(upTheStair, THEMES.light)!;
    ribbon.setBand(-Infinity, 1.0);
    const index = Array.from(ribbon.mesh.geometry.getIndex()!.array);
    expect(Math.max(...index)).toBe(3); // the vertices of points 0 and 1 only
  });

  it("puts no NaN in the buffer for a step straight up", () => {
    // A NaN anywhere in a position buffer blanks the whole mesh.
    const ribbon = createPathRibbon(route([1, 1, 0], [1, 1, 0.17]), THEMES.light)!;
    const position = ribbon.mesh.geometry.getAttribute("position").array as Float32Array;
    expect(Array.from(position).some(Number.isNaN)).toBe(false);
  });

  it("makes nothing of a single point", () => {
    expect(createPathRibbon(route([1, 1, 0]), THEMES.light)).toBeNull();
  });

  // Over the 3D map the band crosses every hue of the height ramp; these are
  // what keep it readable there.
  const companions = (ribbon: NonNullable<ReturnType<typeof createPathRibbon>>) => {
    const [ghost, casing] = ribbon.mesh.children as THREE.Mesh[];
    const material = (mesh: THREE.Mesh) => mesh.material as THREE.MeshBasicMaterial;
    return { ghost, casing, material };
  };

  it("rims the band in a wider casing, drawn first, that follows the floor shown", () => {
    const ribbon = createPathRibbon(upTheStair, THEMES.dark)!;
    const { casing, material } = companions(ribbon);
    expect(material(casing).color.getHex()).toBe(THEMES.dark.pathCasing);
    expect(casing.renderOrder).toBeLessThan(ribbon.mesh.renderOrder);

    const width = (mesh: THREE.Mesh) => {
      const p = mesh.geometry.getAttribute("position");
      return Math.hypot(p.getX(0) - p.getX(1), p.getY(0) - p.getY(1));
    };
    expect(width(casing)).toBeGreaterThan(width(ribbon.mesh));

    ribbon.setBand(-Infinity, 0);
    expect(casing.geometry.getIndex()!.count).toBe(ribbon.mesh.geometry.getIndex()!.count);
  });

  it("still shows, faintly, where the map or the robot stands in front of it", () => {
    const ribbon = createPathRibbon(upTheStair, THEMES.light)!;
    const { ghost, material } = companions(ribbon);
    expect(ghost.geometry).toBe(ribbon.mesh.geometry);
    expect(material(ghost).depthTest).toBe(false);
    expect(material(ghost).depthWrite).toBe(false);
    expect(material(ghost).opacity).toBeLessThan(material(ribbon.mesh).opacity);
    expect(ghost.renderOrder).toBeLessThan(companions(ribbon).casing.renderOrder);
  });
});

const length = ([ax, ay, bx, by]: number[]) => Math.hypot(bx - ax, by - ay);

describe("dashPieces", () => {
  it("never runs a dash past the end of the line", () => {
    // A dock's approach ends on the dock; a dash poking past it would draw
    // onto the charger as if the robot were meant to walk through it.
    for (const end of [0.05, 0.3, 1, 1.07]) {
      const pieces = dashPieces([0, 0, end, 0]);
      for (const piece of pieces) {
        expect(piece[2]).toBeLessThanOrEqual(end + 1e-9);
        expect(length(piece)).toBeGreaterThan(0);
      }
    }
  });

  it("starts on the first point", () => {
    const [first] = dashPieces([2, 3, 4, 3]);
    expect(first![0]).toBe(2);
    expect(first![1]).toBe(3);
  });

  it("carries the dash across a bend instead of restarting it", () => {
    // 0.1 m then a turn: the 0.12 m dash has 0.02 m left to run on the second
    // leg. Restarting per segment would draw a full dash there instead.
    const pieces = dashPieces([0, 0, 0.1, 0, 0.1, 1], 0.12, 0.08);
    expect(length(pieces[0]!)).toBeCloseTo(0.1);
    expect(length(pieces[1]!)).toBeCloseTo(0.02);
    // And the next dash starts a gap later, at 0.2 m along the whole line.
    expect(pieces[2]![1]).toBeCloseTo(0.1);
  });

  it("draws nothing for a line with no length", () => {
    expect(dashPieces([1, 1, 1, 1])).toEqual([]);
    expect(dashPieces([1, 1])).toEqual([]);
    expect(createDashedRibbon([1, 1, 1, 1], 0xffffff)).toBeNull();
  });

  it("rims each dash all round only when asked for a casing", () => {
    const bare = createDashedRibbon([0, 0, 1, 0], 0xffffff)!;
    expect(bare.mesh.children).toHaveLength(1); // the ghost alone

    const rimmed = createDashedRibbon([0, 0, 1, 0], 0xffffff, { casing: 0, casingWidth: 0.01 })!;
    const casing = rimmed.mesh.children[1] as THREE.Mesh;
    casing.geometry.computeBoundingBox();
    rimmed.mesh.geometry.computeBoundingBox();
    const outer = casing.geometry.boundingBox!;
    const inner = rimmed.mesh.geometry.boundingBox!;
    expect(outer.min.x).toBeCloseTo(inner.min.x - 0.01);
    expect(outer.max.y).toBeCloseTo(inner.max.y + 0.01);
  });
});

describe("arrowStations", () => {
  const straight = route([0, 0, 0], [5, 0, 0]);

  it("spaces the chevrons evenly, clear of the robot and of the goal", () => {
    const at = arrowStations(straight, { spacing: 1, first: 0.5, endClear: 0.4 }).map((s) => s.x);
    expect(at).toEqual([0.5, 1.5, 2.5, 3.5, 4.5].filter((x) => x <= 5 - 0.4));
  });

  it("points each one the way the route runs, on the segment it lies on", () => {
    const corner = route([0, 0, 0], [1, 0, 0], [1, 2, 0]);
    const stations = arrowStations(corner, { spacing: 1, first: 0.5, endClear: 0 });
    expect(stations.map(({ tx, ty, segment }) => [tx, ty, segment])).toEqual([
      [1, 0, 1],
      [0, 1, 2],
      [0, 1, 2],
    ]);
  });

  it("carries none on a route shorter than its clearances", () => {
    expect(arrowStations(route([0, 0, 0], [0.5, 0, 0]))).toEqual([]);
  });

  it("puts none on a step straight up", () => {
    const step = route([0, 0, 0], [0, 0, 0.17], [2, 0, 0.17]);
    expect(arrowStations(step, { spacing: 1, first: 0.5, endClear: 0 }).map((s) => s.segment)).toEqual([2, 2]);
  });
});

describe("the route's chevrons", () => {
  const chevrons = (ribbon: NonNullable<ReturnType<typeof createPathRibbon>>) =>
    ribbon.mesh.children[2] as THREE.Mesh;

  it("are drawn in the casing's hue, over the core", () => {
    const ribbon = createPathRibbon(route([0, 0, 0], [4, 0, 0]), THEMES.dark)!;
    const arrows = chevrons(ribbon);
    expect((arrows.material as THREE.MeshBasicMaterial).color.getHex()).toBe(THEMES.dark.pathCasing);
    expect(arrows.geometry.getIndex()!.count).toBeGreaterThan(0);
    const z = arrows.geometry.getAttribute("position").getZ(0);
    expect(z).toBeGreaterThan(ribbon.mesh.geometry.getAttribute("position").getZ(0));
  });

  it("follow the floor shown, as the band does", () => {
    const ribbon = createPathRibbon(route([0, 0, 0], [4, 0, 0], [4, 0, 3], [8, 0, 3]), THEMES.light)!;
    const count = () => chevrons(ribbon).geometry.getIndex()!.count;
    const all = count();
    ribbon.setBand(2, Infinity);
    expect(count()).toBeGreaterThan(0);
    expect(count()).toBeLessThan(all);
    ribbon.setBand(-Infinity, Infinity);
    expect(count()).toBe(all);
  });
});

describe("dashPieces over a route's triples", () => {
  it("walks x and y and steps over z", () => {
    // A dock's approach arrives as a PlannedPath, three numbers a point.
    const pieces = dashPieces([0, 0, 0, 1, 0, 0], 0.12, 0.08, 3);
    expect(pieces[0]).toEqual([0, 0, 0.12, 0]);
    expect(pieces.at(-1)![2]).toBeLessThanOrEqual(1 + 1e-9);
  });
});

describe("the route over the 3D map", () => {
  it("turns pale with a dark rim and chevrons, and back to cyan without it", () => {
    for (const theme of [THEMES.light, THEMES.dark]) {
      const ribbon = createPathRibbon(route([0, 0, 0], [4, 0, 0]), theme)!;
      const [ghost, casing, arrows] = ribbon.mesh.children as THREE.Mesh[];
      const hues = () =>
        [ribbon.mesh, ghost, casing, arrows].map((m) =>
          (m.material as THREE.MeshBasicMaterial).color.getHex(),
        );

      ribbon.setOverMap(true);
      expect(hues()).toEqual([
        theme.pathOverMap,
        theme.pathOverMap,
        theme.pathCasingOverMap,
        theme.pathCasingOverMap,
      ]);
      ribbon.setOverMap(false);
      expect(hues()).toEqual([theme.path, theme.path, theme.pathCasing, theme.pathCasing]);
      ribbon.dispose();
    }
  });
});
