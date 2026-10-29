import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { FLOOR_BAND_ABOVE_M } from "@/lib/map/floors";
import { fitCamera, pointsBox, snapshotBands, snapshotPoints } from "@/lib/scene/voxel-snapshot";
import { OCTREE_KEY_ORIGIN, type OccupiedVoxels } from "@/lib/types/octree";

const O = OCTREE_KEY_ORIGIN;

/**
 * Two storeys at 0.1 m: a ground-floor cell (z -0.45), its ceiling at
 * 2.55 m, a 2F floor cell at 5.05 m and that floor's ceiling at 8.05 m.
 */
function storeys(): OccupiedVoxels {
  return {
    res: 0.1,
    keyMin: [O, O, O - 5],
    size: [1, 1, 86],
    keys: Uint16Array.from([0, 0, 0, 0, 0, 30, 0, 0, 55, 0, 0, 85]),
    count: 4,
    leaves: { occupied: 4, free: 0 },
  };
}

const TWO_FLOORS = [
  { name: "1F", level: 0 },
  { name: "2F", level: 5.5 },
];

describe("snapshotBands", () => {
  it("keeps everything when there are no floors to cut by", () => {
    expect(snapshotBands([])).toEqual([{ lo: -Infinity, hi: Infinity }]);
  });

  it("cuts a map of one storey over its level, under its ceiling", () => {
    expect(snapshotBands([{ name: "1F", level: 0.4 }])).toEqual([
      { lo: -Infinity, hi: 0.4 + FLOOR_BAND_ABOVE_M },
    ]);
  });

  it("cuts a sloping storey over the highest height walked on it, not its level", () => {
    expect(snapshotBands([{ name: "1F", level: -1.5, low: -2.3, high: 0.05 }])).toEqual([
      { lo: -Infinity, hi: 0.05 + FLOOR_BAND_ABOVE_M },
    ]);
  });

  it("keeps each floor's band as the dashboard cuts it", () => {
    const bands = snapshotBands(TWO_FLOORS);
    expect(bands).toHaveLength(2);
    expect(bands[0].lo).toBe(-Infinity);
    expect(bands[1].hi).toBeCloseTo(5.5 + FLOOR_BAND_ABOVE_M);
  });
});

describe("snapshotPoints", () => {
  it("leaves each storey's ceiling out and keeps its floor", () => {
    const { positions, count } = snapshotPoints(storeys(), snapshotBands(TWO_FLOORS));
    expect(count).toBe(2);
    const z = [positions[2], positions[5]].map((v) => +v.toFixed(2));
    expect(z).toEqual([-0.45, 5.05]);
  });

  it("colours the floors kept apart, low to high along the ramp", () => {
    const { colors } = snapshotPoints(storeys(), snapshotBands(TWO_FLOORS));
    // The ramp runs violet (blue-heavy) at the bottom to red at the top.
    expect(colors[2]).toBeGreaterThan(colors[0]);
    expect(colors[3]).toBeGreaterThan(colors[5]);
  });

  it("keeps nothing from a tree with no cell in any band", () => {
    expect(snapshotPoints(storeys(), [{ lo: 100, hi: 200 }]).count).toBe(0);
  });
});

describe("pointsBox", () => {
  /** `n` points evenly along the diagonal from the origin to (10, 4, 2). */
  const diagonal = (n: number) =>
    Float32Array.from({ length: n * 3 }, (_, i) => ([10, 4, 2][i % 3] * Math.floor(i / 3)) / (n - 1));

  it("spans the points on every axis", () => {
    const box = pointsBox(diagonal(1001));
    expect(box.min.x).toBeCloseTo(0.1, 1);
    expect(box.max.x).toBeCloseTo(9.9, 1);
    expect(box.max.y).toBeCloseTo(3.96, 1);
    expect(box.max.z).toBeCloseTo(1.98, 1);
  });

  it("leaves a stray point far off out of the frame's box", () => {
    const points = Float32Array.from([...diagonal(1001), 500, 500, 500]);
    expect(pointsBox(points).max.x).toBeLessThan(11);
  });
});

describe("fitCamera", () => {
  it("frames every corner of the box from the south and above", () => {
    const camera = new THREE.PerspectiveCamera(50, 4 / 3);
    const box = new THREE.Box3(new THREE.Vector3(-20, -10, 0), new THREE.Vector3(20, 10, 6));
    fitCamera(camera, box);

    expect(camera.position.y).toBeLessThan(0);
    expect(camera.position.z).toBeGreaterThan(6);
    const ndc = new THREE.Vector3();
    let widest = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          ndc.set(x, y, z).project(camera);
          widest = Math.max(widest, Math.abs(ndc.x), Math.abs(ndc.y));
        }
      }
    }
    expect(widest).toBeLessThanOrEqual(0.92 + 1e-6);
    // Tight: the box fills the frame on its wider side rather than floating in it.
    expect(widest).toBeGreaterThan(0.9);
  });
});
