import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { createPatchLayer, patchPositions } from "@/lib/scene/ground-patch-layer";
import { voxelPositions } from "@/lib/scene/voxel-layer";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

const O = OCTREE_KEY_ORIGIN;

const voxels: OccupiedVoxels = {
  res: 0.1,
  keyMin: [O + 10, O - 3, O - 5],
  size: [7, 7, 31],
  keys: Uint16Array.from([2, 3, 0]),
  count: 1,
  leaves: { occupied: 1, free: 0 },
};

describe("patchPositions", () => {
  it("puts a patch exactly where a voxel of the same key is drawn", () => {
    // Column (2, 3) on a 7-wide tree is index 2 + 3 * 7.
    const patch = patchPositions(new Map([[2 + 3 * 7, 0]]), voxels);
    expect(Array.from(patch)).toEqual(Array.from(voxelPositions(voxels)));
  });

  it("is empty with no patches", () => {
    expect(patchPositions(new Map(), voxels)).toHaveLength(0);
  });
});

describe("createPatchLayer", () => {
  it("draws one mark per patch, a little larger than a cell so it sits on top", () => {
    const layer = createPatchLayer(new Map([[0, 0], [1, 2]]), voxels, 0x0a6d94);
    const material = layer.points.material as THREE.PointsMaterial;
    expect(layer.points.geometry.getAttribute("position").count).toBe(2);
    expect(material.size).toBeGreaterThan(voxels.res);
    expect(material.color.getHex()).toBe(0x0a6d94);
    layer.dispose();
  });
});
