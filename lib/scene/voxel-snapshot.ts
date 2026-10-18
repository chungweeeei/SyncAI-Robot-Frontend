// A still of the robot's 3D map for the Maps screen's cards: the dashboard's
// opening view of the voxel layer, drawn once into an image. A card shows a
// picture, not a scene, so nothing here stays on the GPU after the call.

import * as THREE from "three";

import { FLOOR_BAND_ABOVE_M, floorBands } from "@/lib/map/floors";
import { heightRange, rampColor } from "@/lib/theme/height-ramp";
import type { MapFloor } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import { voxelPositions } from "@/lib/scene/voxel-layer";

/** The still's size in device pixels: twice the card's tile, so it stays sharp on a dense screen. */
export const SNAPSHOT_WIDTH_PX = 640;
export const SNAPSHOT_HEIGHT_PX = 480;
/** The card's tile (the same light neutral the floor plan's thumbnail sits on). */
const SNAPSHOT_BACKGROUND = 0xe4e4e4;
/** Vertical field of view, degrees: the dashboard camera's. */
const SNAPSHOT_FOV_DEG = 50;
/** How much of the frame the map may fill on its wider side, as NDC. */
const SNAPSHOT_FILL = 0.92;

/**
 * The height bands a still keeps, one per floor: each floor's band as the
 * dashboard cuts it, so what is over a floor's cut — its ceiling — is left
 * out and every storey shows its ground and walls from above. A map of one
 * storey is cut over its level too, which the dashboard has no reason to
 * do (it never hides the one floor there is). No floors at all — a read
 * that failed, a map the backend found none in — keeps everything.
 */
export function snapshotBands(floors: readonly MapFloor[]): Array<{ lo: number; hi: number }> {
  if (floors.length === 0) return [{ lo: -Infinity, hi: Infinity }];
  if (floors.length === 1) return [{ lo: -Infinity, hi: floors[0].level + FLOOR_BAND_ABOVE_M }];
  return floorBands(floors).map(({ lo, hi }) => ({ lo, hi }));
}

/**
 * The voxel centres a still draws — those in one of `bands` — with a colour
 * each, by height over the 1st–99th percentile of what is kept, so the
 * storeys of a building take different hues as they do under All.
 */
export function snapshotPoints(
  voxels: OccupiedVoxels,
  bands: ReadonlyArray<{ lo: number; hi: number }>,
): { positions: Float32Array; colors: Float32Array; count: number } {
  const all = voxelPositions(voxels);
  const positions = new Float32Array(all.length);
  let count = 0;
  for (let i = 0; i < voxels.count; i += 1) {
    const z = all[i * 3 + 2];
    if (!bands.some((band) => z >= band.lo && z < band.hi)) continue;
    positions[count * 3] = all[i * 3];
    positions[count * 3 + 1] = all[i * 3 + 1];
    positions[count * 3 + 2] = z;
    count += 1;
  }
  const kept = positions.subarray(0, count * 3);
  const colors = new Float32Array(count * 3);
  const { lo, hi } = heightRange(kept, 2, 3);
  const span = hi > lo ? hi - lo : 1;
  const rgb: [number, number, number] = [0, 0, 0];
  for (let i = 0; i < count * 3; i += 3) {
    rampColor((kept[i + 2] - lo) / span, rgb);
    colors[i] = rgb[0];
    colors[i + 1] = rgb[1];
    colors[i + 2] = rgb[2];
  }
  return { positions: kept, colors, count };
}

/**
 * The box the still frames, metres: the 1st to 99th percentile of the kept
 * points on each axis, so a few returns off a tree or out of a window do not
 * shrink the building to the middle of the card. What lies past it is drawn
 * all the same, at the edge of the frame or just past it.
 */
export function pointsBox(positions: Float32Array): THREE.Box3 {
  const x = heightRange(positions, 0, 3);
  const y = heightRange(positions, 1, 3);
  const z = heightRange(positions, 2, 3);
  return new THREE.Box3(new THREE.Vector3(x.lo, y.lo, z.lo), new THREE.Vector3(x.hi, y.hi, z.hi));
}

/**
 * Place `camera` on the dashboard's opening line — from the south and above,
 * at `frameMap`'s three-quarter tilt — at the distance that fits the whole
 * box, every corner inside `SNAPSHOT_FILL` of the frame. A bisection on the
 * distance, since a perspective fit of a box has no closed form worth the
 * trouble; forty steps is far below a millimetre.
 */
export function fitCamera(camera: THREE.PerspectiveCamera, box: THREE.Box3): void {
  const target = box.getCenter(new THREE.Vector3());
  const direction = new THREE.Vector3(0, -0.6, 0.8).normalize();
  const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(
    (i) =>
      new THREE.Vector3(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      ),
  );
  const fits = (distance: number) => {
    camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    const ndc = new THREE.Vector3();
    return corners.every((corner) => {
      ndc.copy(corner).project(camera);
      return Math.abs(ndc.x) <= SNAPSHOT_FILL && Math.abs(ndc.y) <= SNAPSHOT_FILL && ndc.z < 1;
    });
  };
  const size = box.getSize(new THREE.Vector3());
  let near = 0;
  let far = Math.max(size.x, size.y, size.z, 1) * 10;
  for (let i = 0; i < 40; i += 1) {
    const mid = (near + far) / 2;
    if (fits(mid)) far = mid;
    else near = mid;
  }
  fits(far);
  camera.near = Math.max(far / 1000, 0.01);
  camera.far = far * 4;
  camera.updateProjectionMatrix();
}

/**
 * The still as a PNG data URL, or null for a tree with nothing in the kept
 * bands. One renderer per call, its context dropped before returning:
 * calls run one after another on the main thread, so a page of cards holds
 * at most one WebGL context at a time and never runs into the browser's cap.
 *
 * A cell is drawn as a square of its own size at the box's centre, never
 * under 1.5 px: a map tens of metres across puts a 10 cm cell under one
 * pixel of the still, and an attenuated sprite that small drops out.
 */
export function renderVoxelSnapshot(voxels: OccupiedVoxels, floors: readonly MapFloor[]): string | null {
  const { positions, colors, count } = snapshotPoints(voxels, snapshotBands(floors));
  if (count === 0) return null;

  const camera = new THREE.PerspectiveCamera(
    SNAPSHOT_FOV_DEG,
    SNAPSHOT_WIDTH_PX / SNAPSHOT_HEIGHT_PX,
  );
  const box = pointsBox(positions);
  fitCamera(camera, box);
  const distance = camera.position.distanceTo(box.getCenter(new THREE.Vector3()));
  const pxPerMetre =
    SNAPSHOT_HEIGHT_PX / (2 * distance * Math.tan(THREE.MathUtils.degToRad(SNAPSHOT_FOV_DEG / 2)));

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: Math.max(1.5, voxels.res * pxPerMetre),
    vertexColors: true,
    sizeAttenuation: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SNAPSHOT_BACKGROUND);
  scene.add(points);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  try {
    renderer.setSize(SNAPSHOT_WIDTH_PX, SNAPSHOT_HEIGHT_PX, false);
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  } finally {
    geometry.dispose();
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
}
