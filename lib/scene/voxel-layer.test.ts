import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { THEMES } from "@/lib/scene/theme";
import {
  createVoxelLayer,
  thinGroundUnderVoxels,
  voxelFrame,
  voxelPositions,
} from "@/lib/scene/voxel-layer";
import { HEIGHT_RAMP } from "@/lib/theme/height-ramp";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

const O = OCTREE_KEY_ORIGIN;

/** A column of three cells on the x axis from the origin, one storey apart in z. */
function voxels(): OccupiedVoxels {
  return {
    res: 0.1,
    keyMin: [O, O - 2, O - 5],
    size: [3, 1, 31],
    keys: Uint16Array.from([0, 0, 0, 1, 0, 0, 2, 0, 30]),
    count: 3,
    leaves: { occupied: 3, free: 0 },
  };
}

describe("voxelPositions", () => {
  it("puts each mark at its cell's centre in map-frame metres", () => {
    const p = voxelPositions(voxels());
    expect(Array.from(p.subarray(0, 3)).map((v) => +v.toFixed(3))).toEqual([0.05, -0.15, -0.45]);
    expect(Array.from(p.subarray(6, 9)).map((v) => +v.toFixed(3))).toEqual([0.25, -0.15, 2.55]);
  });
});

describe("voxelFrame", () => {
  it("is the xy box the cells cover, edge to edge", () => {
    const frame = voxelFrame(voxels());
    expect(frame.widthM).toBeCloseTo(0.3);
    expect(frame.heightM).toBeCloseTo(0.1);
    expect(frame.cx).toBeCloseTo(0.15);
    expect(frame.cy).toBeCloseTo(-0.15);
  });
});

describe("createVoxelLayer", () => {
  it("draws one cell-sized mark per voxel, never culled", () => {
    const layer = createVoxelLayer(voxels());
    const material = layer.points.material as THREE.PointsMaterial;
    expect(layer.points.geometry.getAttribute("position").count).toBe(3);
    expect(material.size).toBe(0.1);
    expect(material.sizeAttenuation).toBe(true);
    expect(material.vertexColors).toBe(true);
    expect(layer.points.frustumCulled).toBe(false);
    layer.dispose();
  });

  it("colours the lowest cell at the ramp's start and the highest at its end", () => {
    const layer = createVoxelLayer(voxels());
    const colors = layer.points.geometry.getAttribute("color").array as Float32Array;
    const first = HEIGHT_RAMP[0][1];
    const last = HEIGHT_RAMP[HEIGHT_RAMP.length - 1][1];
    expect(Array.from(colors.subarray(0, 3)).map((c) => Math.round(c * 255))).toEqual([...first]);
    expect(Array.from(colors.subarray(6, 9)).map((c) => Math.round(c * 255))).toEqual([...last]);
  });

  it("gives a flat floor one hue instead of dividing by zero", () => {
    const flat: OccupiedVoxels = {
      ...voxels(),
      keys: Uint16Array.from([0, 0, 0, 1, 0, 0, 2, 0, 0]),
    };
    const colors = createVoxelLayer(flat).points.geometry.getAttribute("color").array;
    expect(Array.from(colors).every((c) => Number.isFinite(c))).toBe(true);
  });
});

describe("thinGroundUnderVoxels", () => {
  it("thins the plane and puts the theme's opacity back", () => {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ opacity: THEMES.light.groundOpacity, transparent: true }),
    );
    const restore = thinGroundUnderVoxels(ground, THEMES.light);
    expect((ground.material as THREE.MeshBasicMaterial).opacity).toBe(
      THEMES.light.groundOpacityUnderVoxels,
    );
    restore();
    expect((ground.material as THREE.MeshBasicMaterial).opacity).toBe(THEMES.light.groundOpacity);
  });

  it("is a no-op for a map with no floor plan", () => {
    expect(() => thinGroundUnderVoxels(null, THEMES.dark)()).not.toThrow();
  });
});
