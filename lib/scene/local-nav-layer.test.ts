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
} from "@/lib/scene/local-nav-layer";
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
    // The scan and the floor plan under them are what the operator reads there.
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
    expect(mesh.scale.x).toBeCloseTo(0.1);
    expect(mesh.scale.y).toBeCloseTo(0.1);

    // The unit quad runs from the corner, so texel (0, 0) is the origin cell.
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(0);
    expect(mesh.geometry.boundingBox!.max.y).toBeCloseTo(1);
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

  it("follows the robot's ground", () => {
    const layer = createLocalNavLayer(THEMES.light);
    layer.setGround(2.5);
    expect(layer.group.position.z).toBe(2.5);
    layer.dispose();
  });
});
