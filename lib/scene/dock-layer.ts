// A running dock's staging point, and the straight leg from it onto the dock.

import * as THREE from "three";

import { stagingPose } from "@/lib/map/dock";
import { createPoseMarker, placePoseMarker } from "@/lib/scene/markers";
import type { Theme } from "@/lib/scene/theme";
import type { PlanarPose } from "@/lib/types/robot";

/*
 * The leg is dashed because it is intent, not a prediction: the robot does
 * not plan this metre, it steers onto the dock by a control law, and the
 * approach it does predict arrives separately (the dock path ribbon). Half
 * the route's width so the two read as different marks where they overlap.
 */
const LEG_WIDTH_M = 0.06;
const DASH_ON_M = 0.12;
const DASH_OFF_M = 0.08;
/* Over the route (PATH_Z_M) and under the markers, like a stop. */
const LEG_Z_M = 0.016;

/**
 * The [start, end] distances along a segment of length `length` that carry a
 * dash. The last dash is clipped at the end rather than overrunning it, so
 * the leg never pokes past the dock.
 */
export function dashSpans(
  length: number,
  on: number = DASH_ON_M,
  off: number = DASH_OFF_M,
): [number, number][] {
  const spans: [number, number][] = [];
  if (!(length > 0) || !(on > 0)) return spans;
  for (let start = 0; start < length; start += on + Math.max(off, 0)) {
    spans.push([start, Math.min(start + on, length)]);
  }
  return spans;
}

/**
 * The staging point (a pose marker in the dock hue) and the dashed leg from it
 * to the dock, as one group with its disposer. Built per dock pose: it only
 * changes when a dock starts, so a rebuild is cheaper than a mutable layer.
 */
export function createDockLayer(
  dock: PlanarPose,
  theme: Theme,
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const staging = stagingPose(dock);

  const marker = createPoseMarker(theme.dock, 0.9);
  placePoseMarker(marker, staging);
  group.add(marker);

  const dx = dock.x - staging.x;
  const dy = dock.y - staging.y;
  const length = Math.hypot(dx, dy);
  const legMaterial = new THREE.MeshBasicMaterial({
    color: theme.dock,
    transparent: true,
    opacity: 0.85,
    side: THREE.DoubleSide,
  });
  let legGeometry: THREE.BufferGeometry | null = null;
  if (length > 1e-6) {
    const tx = dx / length;
    const ty = dy / length;
    // Left normal, as in path-ribbon.ts.
    const ox = -ty * (LEG_WIDTH_M / 2);
    const oy = tx * (LEG_WIDTH_M / 2);
    const positions: number[] = [];
    const indices: number[] = [];
    for (const [from, to] of dashSpans(length)) {
      const ax = staging.x + tx * from;
      const ay = staging.y + ty * from;
      const bx = staging.x + tx * to;
      const by = staging.y + ty * to;
      const v = positions.length / 3;
      positions.push(
        ax + ox, ay + oy, LEG_Z_M,
        ax - ox, ay - oy, LEG_Z_M,
        bx + ox, by + oy, LEG_Z_M,
        bx - ox, by - oy, LEG_Z_M,
      );
      indices.push(v, v + 1, v + 3, v, v + 3, v + 2);
    }
    legGeometry = new THREE.BufferGeometry();
    legGeometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    legGeometry.setIndex(indices);
    group.add(new THREE.Mesh(legGeometry, legMaterial));
  }

  return {
    group,
    dispose: () => {
      // The marker's meshes share one material; dispose it once.
      const markerMaterials = new Set<THREE.Material>();
      marker.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          markerMaterials.add(object.material as THREE.Material);
        }
      });
      for (const material of markerMaterials) material.dispose();
      legGeometry?.dispose();
      legMaterial.dispose();
    },
  };
}
