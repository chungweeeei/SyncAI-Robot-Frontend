import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { THEMES } from "@/lib/scene/theme";
import { createVoxelLayer, thinGroundUnderVoxels } from "@/lib/scene/voxel-layer";
import type { PointCloudFrame } from "@/lib/types/pointcloud";

const frame = (...xyz: number[]): PointCloudFrame => ({
  count: xyz.length / 3,
  positions: new Float32Array(xyz),
});

const frames = () => ({
  road: frame(0, 0, -0.45, 0.1, 0, -0.45),
  occupied: frame(1, 1, 0.5),
});

const layers = (group: THREE.Group) => group.children as THREE.Points[];
const material = (points: THREE.Points) => points.material as THREE.PointsMaterial;

describe("createVoxelLayer", () => {
  it("draws the floor and the walls as two point layers in their own hues", () => {
    const [floor, walls] = layers(createVoxelLayer(frames(), 0.1, THEMES.light).group);
    expect(floor).toBeInstanceOf(THREE.Points);
    expect(walls).toBeInstanceOf(THREE.Points);
    expect(material(floor).color.getHex()).toBe(THEMES.light.voxelFloor);
    expect(material(walls).color.getHex()).toBe(THEMES.light.voxelWall);
  });

  it("sizes each mark to one cell in world units, so the floor tiles without gaps", () => {
    for (const points of layers(createVoxelLayer(frames(), 0.05, THEMES.dark).group)) {
      expect(material(points).size).toBe(0.05);
      expect(material(points).sizeAttenuation).toBe(true);
    }
  });

  it("references the cached frames rather than copying them", () => {
    const input = frames();
    const [floor, walls] = layers(createVoxelLayer(input, 0.1, THEMES.light).group);
    expect(floor.geometry.getAttribute("position").array).toBe(input.road.positions);
    expect(walls.geometry.getAttribute("position").array).toBe(input.occupied.positions);
  });

  it("is never culled, since no bounds are computed for it", () => {
    for (const points of layers(createVoxelLayer(frames(), 0.1, THEMES.light).group)) {
      expect(points.frustumCulled).toBe(false);
    }
  });

  it("stays opaque, so the translucent floor plan blends over it instead of hiding it", () => {
    for (const points of layers(createVoxelLayer(frames(), 0.1, THEMES.light).group)) {
      expect(material(points).transparent).toBe(false);
    }
  });

  it("builds an empty layer rather than throwing", () => {
    const { group } = createVoxelLayer({ road: frame(), occupied: frame() }, 0.1, THEMES.light);
    expect(layers(group)).toHaveLength(2);
  });

  it("frees both geometries and materials on dispose, and leaves the frames alone", () => {
    const input = frames();
    const { group, dispose } = createVoxelLayer(input, 0.1, THEMES.light);
    const spies = layers(group).flatMap((points) => [
      vi.spyOn(points.geometry, "dispose"),
      vi.spyOn(material(points), "dispose"),
    ]);
    dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(input.road.positions[2]).toBeCloseTo(-0.45);
  });
});

describe("thinGroundUnderVoxels", () => {
  const plane = (opacity: number) =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ transparent: true, opacity }),
    );

  it("thins the floor plan while the 3D map is up and puts the theme's opacity back", () => {
    const ground = plane(THEMES.dark.groundOpacity);
    const material = ground.material as THREE.MeshBasicMaterial;
    const restore = thinGroundUnderVoxels(ground, THEMES.dark);
    expect(material.opacity).toBe(THEMES.dark.groundOpacityUnderVoxels);
    expect(material.opacity).toBeLessThan(THEMES.dark.groundOpacity);
    restore();
    expect(material.opacity).toBe(THEMES.dark.groundOpacity);
  });

  it("does nothing on a map with no floor plan", () => {
    expect(() => thinGroundUnderVoxels(null, THEMES.light)()).not.toThrow();
  });
});
