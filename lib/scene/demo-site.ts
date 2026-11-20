// The sign-in screen's set: a corner of a warehouse for the robot to walk
// round. Made up, and plain on purpose: a few blocks in one neutral, so the
// robot and its route are what the eye finds.

import * as THREE from "three";

import type { Theme } from "@/lib/scene/theme";

/** A box on the ground: centre x, y and its size, metres. */
interface Prop {
  x: number;
  y: number;
  w: number;
  d: number;
  h: number;
}

/**
 * Inside the robot's oval (walk-loop.ts, 2.6 × 1.6 m) a shelving run; round
 * it crates and the building's columns, all clear of the oval by more than
 * the robot's half-width, so it never walks through one, and low or far
 * enough that none hides it from the camera.
 */
export const DEMO_PROPS: readonly Prop[] = [
  // The shelving run the robot circles: two bays and their uprights' line.
  { x: -0.75, y: 0, w: 1.4, d: 0.6, h: 1.6 },
  { x: 0.75, y: 0, w: 1.4, d: 0.6, h: 1.6 },
  // Crates, one stacked.
  { x: 3.7, y: 1.1, w: 0.6, d: 0.6, h: 0.5 },
  { x: 3.7, y: 1.1, w: 0.5, d: 0.5, h: 0.95 },
  { x: 4.2, y: 0.3, w: 0.6, d: 0.8, h: 0.45 },
  { x: -3.8, y: -1.0, w: 0.7, d: 0.6, h: 0.55 },
  { x: -1.2, y: -2.6, w: 0.6, d: 0.6, h: 0.5 },
  // Columns, out past where the camera walks round (walk-loop.ts's
  // chaseCamera), so one never stands between it and the robot.
  { x: 6.4, y: 4.6, w: 0.4, d: 0.4, h: 3.2 },
  { x: -6.4, y: 4.6, w: 0.4, d: 0.4, h: 3.2 },
  { x: 6.4, y: -4.6, w: 0.4, d: 0.4, h: 3.2 },
  { x: -6.4, y: -4.6, w: 0.4, d: 0.4, h: 3.2 },
];

/** The set, standing on `groundZ`. The caller disposes it with the scene. */
export function createDemoSite(theme: Theme, groundZ: number): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({
    color: theme.sceneProp,
    roughness: 0.9,
    metalness: 0,
    flatShading: true,
  });
  for (const prop of DEMO_PROPS) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(prop.w, prop.d, prop.h), material);
    mesh.position.set(prop.x, prop.y, groundZ + prop.h / 2);
    group.add(mesh);
  }
  return group;
}
