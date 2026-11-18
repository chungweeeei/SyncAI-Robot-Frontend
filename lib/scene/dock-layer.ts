// A running charge's staging point, and the straight leg from it onto the
// charger's marker.

import * as THREE from "three";

import { stagingPose } from "@/lib/map/dock";
import { drawnGround } from "@/lib/map/floors";
import { standsOnMap, type SurfaceTop } from "@/lib/scene/map-surface";
import { createDashedRibbon } from "@/lib/scene/path-ribbon";
import type { Theme } from "@/lib/scene/theme";
import type { PlanarPose } from "@/lib/types/robot";

/*
 * The staging point is a dot, not a pose marker: the robot only passes
 * through it on the way in, and a robot-sized ring and arrow read as a goal
 * the operator set. The leg already says which way it faces.
 */
const STAGING_DOT_RADIUS_M = 0.09;
/* The rim around it, so the dot keeps its edge over the green trajectory. */
const STAGING_CASING_RADIUS_M = 0.12;
/* Over the leg, under the goal markers (MARKER_Z_M); the rim just under it. */
const STAGING_DOT_Z_M = 0.02;
const STAGING_CASING_Z_M = 0.018;

/*
 * The leg is dashed because it is intent, not a prediction: the robot does
 * not plan this metre, it steers onto the dock by a control law. Half the
 * route's width so it reads as a different mark from the predicted approach
 * (also dashed, at full width) where the two overlap.
 */
const LEG_WIDTH_M = 0.06;
/* Over the route (PATH_Z_M) and under the markers, like a stop. */
const LEG_Z_M = 0.016;

/**
 * The staging point (a green dot on a rim) and the dashed leg from it to the
 * dock, as one group with its disposer. Built per dock pose: it only changes
 * when a dock starts, so a rebuild is cheaper than a mutable layer.
 * The leg runs on to the marker, past where the robot stops: where it stops
 * is the charger's geometry, the robot's to know.
 *
 * `preview` is a charger tapped on the map rather than one being charged at:
 * the same marks, the dot in `stagingPreview`, since the robot is not heading
 * there and the live hue would say it is.
 *
 * `surfaceTop` is the 3D map's floor: the marks stand on its top face under
 * the staging point, because the charger's z is a cell's centre and the dot
 * a hair over it lay under the drawn cells, where the depth test hid it.
 * Without it (no tree read yet) they lie on the charger's ground.
 */
export function createDockLayer(
  dock: PlanarPose & { z?: number },
  theme: Theme,
  { preview = false, surfaceTop = null }: { preview?: boolean; surfaceTop?: SurfaceTop | null } = {},
): { group: THREE.Group; dispose: () => void } {
  const group = new THREE.Group();
  const staging = stagingPose(dock);
  // The charger's own ground, which a running charge read without a z puts on
  // the ground floor; then the floor the map draws under the staging point.
  const chargerGround = drawnGround(dock.z ?? 0);
  group.position.z = standsOnMap(staging.x, staging.y, chargerGround, surfaceTop);

  const dotGeometry = new THREE.CircleGeometry(STAGING_DOT_RADIUS_M, 24);
  const dotMaterial = new THREE.MeshBasicMaterial({
    color: preview ? theme.stagingPreview : theme.staging,
    side: THREE.DoubleSide,
  });
  const dot = new THREE.Mesh(dotGeometry, dotMaterial);
  dot.position.set(staging.x, staging.y, STAGING_DOT_Z_M);
  group.add(dot);

  const leg = createDashedRibbon([staging.x, staging.y, dock.x, dock.y], theme.dock, {
    width: LEG_WIDTH_M,
    z: LEG_Z_M,
  });
  if (leg) group.add(leg.mesh);

  const casingGeometry = new THREE.CircleGeometry(STAGING_CASING_RADIUS_M, 24);
  const casingMaterial = new THREE.MeshBasicMaterial({
    color: theme.stagingCasing,
    side: THREE.DoubleSide,
  });
  const casing = new THREE.Mesh(casingGeometry, casingMaterial);
  casing.position.set(staging.x, staging.y, STAGING_CASING_Z_M);
  group.add(casing);

  return {
    group,
    dispose: () => {
      dotGeometry.dispose();
      dotMaterial.dispose();
      casingGeometry.dispose();
      casingMaterial.dispose();
      leg?.dispose();
    },
  };
}
