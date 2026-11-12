import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { aimRaycaster, intersectGround, pickVertex, projectToScreen } from "@/lib/scene/picking";
import type { MapVertex } from "@/lib/types/map";

describe("aimRaycaster", () => {
  it("aims from where the camera is now, not where it was last drawn", () => {
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
    camera.up.set(0, 0, 1);
    camera.position.set(5, -5, 5);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    // A framing turns it between frames: no render has refreshed the matrix,
    // and lookAt refreshes the matrix before it turns, not after.
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);

    const raycaster = new THREE.Raycaster();
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    aimRaycaster(raycaster, camera, rect, 50, 50);
    expect(raycaster.ray.origin.x).toBeCloseTo(0);
    expect(raycaster.ray.direction.z).toBeCloseTo(-1);
  });
});

/** A camera straight over the origin, looking down, 10 m up. */
function overhead(): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 100);
  camera.up.set(0, 1, 0);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  return camera;
}

describe("projectToScreen", () => {
  it("is the inverse of a cast: a point lands where a press on it would be aimed from", () => {
    const camera = overhead();
    // Not at the page's corner, as a canvas under the strip is not.
    const rect = { left: 40, top: 60, width: 200, height: 200 };
    const [at] = projectToScreen(camera, rect, [{ x: 1.5, y: -2, z: 0.3 }]);

    const raycaster = new THREE.Raycaster();
    aimRaycaster(raycaster, camera, rect, at.cx, at.cy);
    const hit = intersectGround(raycaster, 0.3);
    expect(hit?.wx).toBeCloseTo(1.5);
    expect(hit?.wy).toBeCloseTo(-2);
  });
});

describe("pickVertex", () => {
  const stop = { id: "a", name: "Dock", x: 0, y: 0, z: 0, theta: 0 } as unknown as MapVertex;

  function layerWith(...ids: string[]) {
    const pickables = ids.map((id, index) => {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(0.5, 16));
      // The later one nearer the camera, over the earlier.
      disc.position.z = index;
      disc.userData.vertexId = id;
      disc.updateMatrixWorld();
      return disc;
    });
    return { pickables, byId: new Map([[stop.id, stop]]) };
  }

  it("is the stop the ray meets first, or none", () => {
    const camera = overhead();
    const rect = { left: 0, top: 0, width: 100, height: 100 };
    const raycaster = new THREE.Raycaster();
    aimRaycaster(raycaster, camera, rect, 50, 50);
    expect(pickVertex(raycaster, layerWith("a"))).toBe(stop);
    aimRaycaster(raycaster, camera, rect, 2, 2);
    expect(pickVertex(raycaster, layerWith("a"))).toBeNull();
  });

  it("is none for a marker whose stop the layer no longer holds", () => {
    const camera = overhead();
    const raycaster = new THREE.Raycaster();
    aimRaycaster(raycaster, camera, { left: 0, top: 0, width: 100, height: 100 }, 50, 50);
    // "gone" is on top, and is not in byId: a retired id must not fall
    // through to the stop under it.
    expect(pickVertex(raycaster, layerWith("a", "gone"))).toBeNull();
  });
});
