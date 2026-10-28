import * as THREE from "three";
import { describe, expect, it } from "vitest";

import {
  COST_FREE,
  COST_INSCRIBED,
  COST_LETHAL,
  COST_UNKNOWN,
  costAlpha,
  costmapRgba,
  createLocalNavLayer,
  fillHeights,
} from "@/lib/scene/local-nav-layer";
import { createPathRibbon } from "@/lib/scene/path-ribbon";
import { THEMES } from "@/lib/scene/theme";
import type { LocalCostmap, PlannedPath } from "@/lib/types/robot";

function costmap(fields: Partial<LocalCostmap> = {}): LocalCostmap {
  return {
    resolution: 0.05,
    width: 2,
    height: 2,
    origin: { x: 1, y: 2, yaw: Math.PI / 2 },
    cells: new Uint8Array([COST_FREE, 100, COST_LETHAL, COST_UNKNOWN]),
    stamp: 30,
    ...fields,
  };
}

/** The quad the costmap is drawn on: the costmap frame's only child. */
function quad(group: THREE.Group): THREE.Mesh {
  const frame = group.children[0] as THREE.Group;
  return frame.children[0] as THREE.Mesh;
}

describe("costAlpha", () => {
  it("draws neither free nor never-seen cells", () => {
    // The scan and the 3D map under them are what the operator reads there.
    expect(costAlpha(COST_FREE)).toBe(0);
    expect(costAlpha(COST_UNKNOWN)).toBe(0);
  });

  it("orders obstacle over too-close over the margin", () => {
    expect(costAlpha(COST_LETHAL)).toBeGreaterThan(costAlpha(COST_INSCRIBED));
    expect(costAlpha(COST_INSCRIBED)).toBeGreaterThan(costAlpha(COST_INSCRIBED - 1));
  });

  it("fades the margin out with the cost", () => {
    // The gradient is how much room the robot thinks it has.
    let last = 0;
    for (let cost = 1; cost < COST_INSCRIBED; cost++) {
      expect(costAlpha(cost)).toBeGreaterThan(last);
      last = costAlpha(cost);
    }
  });
});

describe("costmapRgba", () => {
  it("writes one hue with each cell's opacity, in the robot's row order", () => {
    const rgba = costmapRgba(new Uint8Array([COST_FREE, COST_LETHAL]), 0x112233);

    expect(Array.from(rgba)).toEqual([
      0x11, 0x22, 0x33, 0,
      0x11, 0x22, 0x33, Math.round(costAlpha(COST_LETHAL) * 255),
    ]);
  });

  it("reuses a buffer of the right size", () => {
    const out = new Uint8Array(8);
    expect(costmapRgba(new Uint8Array([1, 2]), 0, out)).toBe(out);
  });
});

describe("createLocalNavLayer", () => {
  it("lays the costmap's corner on its origin, turned and sized by the grid", () => {
    const layer = createLocalNavLayer(THEMES.light);
    layer.setCostmap(costmap());

    const frame = layer.group.children[0] as THREE.Group;
    expect(frame.position.x).toBeCloseTo(1);
    expect(frame.position.y).toBeCloseTo(2);
    expect(frame.rotation.z).toBeCloseTo(Math.PI / 2);
    const mesh = quad(layer.group);
    expect(mesh.visible).toBe(true);

    // The sheet runs from the corner, so texel (0, 0) is the origin cell, and
    // spans the grid: two cells of 0.05 m.
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(0);
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(0.1);
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(0.1);
    layer.dispose();
  });

  it("drapes the costmap over the map's ground, at map heights whatever the robot's", () => {
    const layer = createLocalNavLayer(THEMES.light);
    layer.setGround(-0.5);
    // A slope rising 0.5 m a metre along the map's x.
    layer.setSurface((wx) => -0.5 + 0.5 * wx);
    layer.setCostmap(costmap({ width: 20, height: 20, cells: new Uint8Array(400), origin: { x: 0, y: 0, yaw: 0 } }));

    const mesh = quad(layer.group);
    const position = mesh.geometry.getAttribute("position");
    const frame = layer.group.children[0] as THREE.Group;
    // A vertex's height on screen: its own, plus its frame's, plus the group's.
    const worldZ = (i: number) => position.getZ(i) + frame.position.z + layer.group.position.z;
    for (let i = 0; i < position.count; i++) {
      expect(worldZ(i)).toBeCloseTo(-0.5 + 0.5 * position.getX(i));
    }

    // The robot walks on: its ground moves, the sheet stays on the map's.
    layer.setGround(-0.3);
    for (let i = 0; i < position.count; i++) {
      expect(worldZ(i)).toBeCloseTo(-0.5 + 0.5 * position.getX(i));
    }
    layer.dispose();
  });

  it("follows the map's yaw-turned frame when sampling the ground", () => {
    const layer = createLocalNavLayer(THEMES.light);
    const seen: [number, number][] = [];
    layer.setSurface((wx, wy) => {
      seen.push([wx, wy]);
      return 0;
    });
    // Turned a quarter: the costmap's own x runs along the map's y.
    layer.setCostmap(costmap({ width: 20, height: 2, cells: new Uint8Array(40), origin: { x: 1, y: 2, yaw: Math.PI / 2 } }));
    const xs = seen.map(([x]) => x);
    const ys = seen.map(([, y]) => y);
    expect(Math.min(...ys)).toBeCloseTo(2);
    expect(Math.max(...ys)).toBeCloseTo(3);
    expect(Math.max(...xs)).toBeCloseTo(1);
    expect(Math.min(...xs)).toBeCloseTo(0.9);
    layer.dispose();
  });

  it("lies flat on the robot's ground again once the map is gone", () => {
    const layer = createLocalNavLayer(THEMES.light);
    layer.setGround(-0.5);
    layer.setSurface(() => 1.0);
    layer.setCostmap(costmap({ width: 20, height: 20, cells: new Uint8Array(400), origin: { x: 0, y: 0, yaw: 0 } }));
    layer.setSurface(null);

    const mesh = quad(layer.group);
    const position = mesh.geometry.getAttribute("position");
    const frame = layer.group.children[0] as THREE.Group;
    expect(frame.position.z).toBe(0);
    for (let i = 0; i < position.count; i++) expect(position.getZ(i)).toBe(0);
    expect(layer.group.position.z).toBe(-0.5);
    layer.dispose();
  });

  it("hides the costmap on the end-of-navigation clear", () => {
    const layer = createLocalNavLayer(THEMES.dark);
    layer.setCostmap(costmap());
    layer.setCostmap(costmap({ width: 0, height: 0, cells: new Uint8Array() }));

    expect(quad(layer.group).visible).toBe(false);
    layer.dispose();
  });

  it("keeps one texture while the size holds, and a new one when it changes", () => {
    const layer = createLocalNavLayer(THEMES.light);
    layer.setCostmap(costmap());
    const material = quad(layer.group).material as THREE.MeshBasicMaterial;
    const first = material.map;

    layer.setCostmap(costmap({ stamp: 31 }));
    expect(material.map).toBe(first);

    layer.setCostmap(costmap({ width: 1, height: 1, cells: new Uint8Array([COST_LETHAL]) }));
    expect(material.map).not.toBe(first);
    layer.dispose();
  });

  it("replaces the trajectory and removes it on the clear", () => {
    const layer = createLocalNavLayer(THEMES.light);
    const plan = (points: number[]): PlannedPath => ({
      points: new Float32Array(points),
      stamp: 1,
    });

    layer.setPlan(plan([0, 0, 0, 1, 0, 0]));
    expect(layer.group.children).toHaveLength(2);
    layer.setPlan(plan([0, 0, 0, 0, 1, 0]));
    expect(layer.group.children).toHaveLength(2);
    layer.setPlan(plan([]));
    expect(layer.group.children).toHaveLength(1);
    layer.dispose();
  });

  it("draws the trajectory after the route it runs down, rimmed", () => {
    const layer = createLocalNavLayer(THEMES.dark);
    layer.setPlan({ points: new Float32Array([0, 0, 0, 1, 0, 0]), stamp: 1 });
    const thread = layer.group.children[1] as THREE.Mesh;
    const route = createPathRibbon(Float32Array.from([0, 0, 0, 1, 0, 0]), THEMES.dark)!;
    const orders = (mesh: THREE.Mesh) => [mesh, ...mesh.children].map((o) => o.renderOrder);
    expect(Math.min(...orders(thread))).toBeGreaterThan(Math.max(...orders(route.mesh)));
    const casing = thread.children[1] as THREE.Mesh;
    expect((casing.material as THREE.MeshBasicMaterial).color.getHex()).toBe(
      THEMES.dark.localPlanCasing,
    );
    route.dispose();
    layer.dispose();
  });

  it("turns the costmap pale over the 3D map, repainting the one on screen", () => {
    const layer = createLocalNavLayer(THEMES.dark);
    layer.setCostmap(costmap({ width: 1, height: 1, cells: new Uint8Array([COST_LETHAL]) }));
    const material = quad(layer.group).material as THREE.MeshBasicMaterial;
    // Blue, the channel amber and the pale wash differ most in.
    const blue = () => (material.map!.image.data as Uint8Array)[2];

    expect(blue()).toBe(THEMES.dark.localCostmap & 0xff);
    layer.setOverMap(true);
    expect(blue()).toBe(THEMES.dark.localCostmapOverMap & 0xff);
    layer.setOverMap(false);
    expect(blue()).toBe(THEMES.dark.localCostmap & 0xff);
    layer.dispose();
  });

  it("follows the robot's ground", () => {
    const layer = createLocalNavLayer(THEMES.light);
    layer.setGround(2.5);
    expect(layer.group.position.z).toBe(2.5);
    layer.dispose();
  });
});

describe("fillHeights", () => {
  it("keeps every height the map had", () => {
    expect(Array.from(fillHeights([1, 2, 3, 4], 2, 2, 0))).toEqual([1, 2, 3, 4]);
  });

  it("fills a hole from its neighbours rather than dropping to the robot's ground", () => {
    // A wall's column in the middle of a level floor at 1 m.
    const heights = fillHeights([1, 1, 1, 1, null, 1, 1, 1, 1], 3, 3, -5);
    expect(heights[4]).toBeCloseTo(1);
  });

  it("reaches a gap several vertices wide, ring by ring", () => {
    const heights = fillHeights([2, null, null, null, null], 5, 1, -5);
    expect(Array.from(heights)).toEqual([2, 2, 2, 2, 2]);
  });

  it("takes the fallback where the map has no ground at all", () => {
    expect(Array.from(fillHeights([null, null], 2, 1, -0.48))).toEqual(
      [-0.48, -0.48].map((h) => Math.fround(h)),
    );
  });
});
