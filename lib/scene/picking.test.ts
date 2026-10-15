import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { aimRaycaster } from "@/lib/scene/picking";

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
