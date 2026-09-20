// Projecting a pointer position onto the map floor.

import * as THREE from "three";

/**
 * The z=0 map plane the pointer is projected onto to pick a goal.
 *
 * Deliberately the mathematical plane rather than a raycast against the ground
 * *mesh*: the mesh only spans the occupancy grid (and does not exist at all
 * without a 2D map), while goal mode has to work anywhere the operator can see
 * floor. Bounds are then checked separately against the map extent.
 */
const GROUND_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

/**
 * Scratch for the pointer raycast, reused so a pointermove allocates nothing.
 *
 * Safe to share because three.js reads both and keeps neither: `setFromCamera`
 * copies the NDC pair out, and every caller of `intersectPlane` below copies
 * the two numbers it wants before the next cast.
 */
const POINTER_NDC = new THREE.Vector2();
const GROUND_HIT = new THREE.Vector3();

/**
 * Aim a raycaster through a pointer position, given the canvas rect it was
 * measured against. The caller owns the raycaster so a pointermove reuses one.
 */
export function aimRaycaster(
  raycaster: THREE.Raycaster,
  camera: THREE.Camera,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
) {
  raycaster.setFromCamera(
    POINTER_NDC.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    ),
    camera,
  );
}

/** Where an aimed ray meets z=0, or null when it runs parallel or skyward. */
export function intersectGround(
  raycaster: THREE.Raycaster,
): { wx: number; wy: number } | null {
  const hit = raycaster.ray.intersectPlane(GROUND_PLANE, GROUND_HIT);
  return hit ? { wx: hit.x, wy: hit.y } : null;
}
