import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { THEMES } from "@/lib/scene/theme";
import {
  createVoxelLayer,
  sortByHeight,
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
    const colors = layer.points.geometry.getAttribute("color").array as Uint8Array;
    const first = HEIGHT_RAMP[0][1];
    const last = HEIGHT_RAMP[HEIGHT_RAMP.length - 1][1];
    expect(Array.from(colors.subarray(0, 3))).toEqual([...first]);
    expect(Array.from(colors.subarray(6, 9))).toEqual([...last]);
  });

  it("draws each mark at its cell's centre, as voxelPositions puts it", () => {
    const layer = createVoxelLayer(voxels());
    layer.points.updateMatrixWorld();
    const attribute = layer.points.geometry.getAttribute("position");
    const expected = voxelPositions(voxels());
    for (let i = 0; i < 3; i += 1) {
      const p = new THREE.Vector3().fromBufferAttribute(attribute, i).applyMatrix4(layer.points.matrixWorld);
      expect(p.x).toBeCloseTo(expected[i * 3]);
      expect(p.y).toBeCloseTo(expected[i * 3 + 1]);
      expect(p.z).toBeCloseTo(expected[i * 3 + 2]);
    }
    // The sprite stays one cell across, whatever the scale does to positions.
    expect((layer.points.material as THREE.PointsMaterial).size).toBe(0.1);
    expect(layer.ghost.position.equals(layer.points.position)).toBe(true);
    expect(layer.ghost.scale.equals(layer.points.scale)).toBe(true);
    layer.dispose();
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

describe("the layer's height band", () => {
  /** Two storeys, out of height order the way a tree's walk hands them over. */
  function storeys(): OccupiedVoxels {
    return {
      res: 0.1,
      keyMin: [O, O, O - 5],
      size: [2, 1, 61],
      // z = -0.45 (k 0), 5.55 (k 60), -0.45, 2.55 (k 30)
      keys: Uint16Array.from([0, 0, 0, 0, 0, 60, 1, 0, 0, 1, 0, 30]),
      count: 4,
      leaves: { occupied: 4, free: 0 },
    };
  }

  it("holds the cells in height order, keeping the tree's order within a level", () => {
    expect(Array.from(sortByHeight(storeys()).order)).toEqual([0, 2, 3, 1]);
  });

  it("draws only the cells whose centre is in the band", () => {
    const layer = createVoxelLayer(storeys());
    const range = () => layer.points.geometry.drawRange;

    layer.setBand(-Infinity, 4.5);
    expect([range().start, range().count]).toEqual([0, 3]);
    layer.setBand(4.5, Infinity);
    expect([range().start, range().count]).toEqual([3, 1]);
    layer.setBand(-Infinity, Infinity);
    expect([range().start, range().count]).toEqual([0, 4]);
    // Edges: a centre on `lo` is in, one on `hi` is out.
    layer.setBand(2.55, 5.55);
    expect([range().start, range().count]).toEqual([2, 1]);
    layer.dispose();
  });

  it("draws faint every cell under the band, and nothing above it or with no band", () => {
    const layer = createVoxelLayer(storeys());
    const ghost = () => layer.ghost.geometry.drawRange;

    // Nothing under the whole map, nor under the lowest floor.
    expect(ghost().count).toBe(0);
    layer.setBand(-Infinity, 4.5);
    expect(ghost().count).toBe(0);
    // Upstairs: the three cells below it, never the one on show.
    layer.setBand(4.5, Infinity);
    expect([ghost().start, ghost().count]).toEqual([0, 3]);
    // A middle floor: the ground floor under it, not the storey over it.
    layer.setBand(2.55, 5.55);
    expect([ghost().start, ghost().count]).toEqual([0, 2]);
    layer.setBand(-Infinity, Infinity);
    expect(ghost().count).toBe(0);
    // Faint, and never hiding what stands on it.
    const material = layer.ghost.material as THREE.PointsMaterial;
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    layer.dispose();
  });

  it("recolours a band over its own heights", () => {
    const layer = createVoxelLayer(storeys());
    const colors = () => layer.points.geometry.getAttribute("color").array as Uint8Array;
    const last = HEIGHT_RAMP[HEIGHT_RAMP.length - 1][1];

    layer.setBand(-Infinity, 4.5);
    // 2.55 m is the band's top, so the ramp's end, though the map goes higher.
    expect(Array.from(colors().subarray(6, 9))).toEqual([...last]);
    layer.dispose();
  });

  it("keeps the whole map's colours on a band that asks for them, wherever it slides", () => {
    const layer = createVoxelLayer(storeys());
    const colors = () => layer.points.geometry.getAttribute("color").array as Uint8Array;
    const before = Array.from(colors());

    layer.setBand(-Infinity, 4.5, { ramp: "map" });
    expect(Array.from(colors())).toEqual(before);
    layer.setBand(1, 6, { ramp: "map" });
    expect(Array.from(colors())).toEqual(before);
    layer.dispose();
  });

  it("paints and uploads nothing while a whole-map band slides", () => {
    const layer = createVoxelLayer(storeys());
    const attribute = layer.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    const version = attribute.version;

    layer.setBand(-Infinity, 4.5, { ramp: "map" });
    layer.setBand(1, 6, { ramp: "map" });
    expect(attribute.version).toBe(version);
    expect(attribute.updateRanges).toEqual([]);
    layer.dispose();
  });

  it("puts a floor's own colours back to the whole map's when it is left", () => {
    const layer = createVoxelLayer(storeys());
    const attribute = layer.points.geometry.getAttribute("color") as THREE.BufferAttribute;
    const colors = () => Array.from(attribute.array);
    const whole = colors();

    // Upstairs alone is one height, so its own ramp starts over at the bottom.
    layer.setBand(4.5, Infinity);
    expect(colors()).not.toEqual(whole);
    // Only the floor's one cell went up, not the whole buffer.
    expect(attribute.updateRanges).toEqual([{ start: 9, count: 3 }]);
    attribute.clearUpdateRanges();
    // The same floor again: nothing to paint.
    const version = attribute.version;
    layer.setBand(4.5, Infinity);
    expect(attribute.version).toBe(version);

    layer.setBand(1, 6, { ramp: "map" });
    expect(colors()).toEqual(whole);
    layer.setBand(4.5, Infinity);
    layer.setBand(-Infinity, 4.5);
    // The lower floor holds its own ramp; the upper one is the whole map's again.
    expect(colors().slice(9)).toEqual(whole.slice(9));
    layer.setBand(-Infinity, Infinity);
    expect(colors()).toEqual(whole);
    layer.dispose();
  });

  it("reports the z the band's cells span, edge to edge, and null for an empty band", () => {
    const layer = createVoxelLayer(storeys());
    const lower = layer.zExtent(-Infinity, 4.5)!;
    expect(lower.lo).toBeCloseTo(-0.5);
    expect(lower.hi).toBeCloseTo(2.6);
    expect(layer.zExtent(3, 4)).toBeNull();
    layer.dispose();
  });
});
