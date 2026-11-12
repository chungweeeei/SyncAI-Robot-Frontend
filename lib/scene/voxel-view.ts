// A 3D view whose picture is one 3D map, shaded and drawn only when it
// changed: what the map editor and the task editor's route map build the
// same way. What each puts over the map, and its pointers, stay its own.

import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { frameGround } from "@/lib/scene/camera";
import { createEdlPass, type EdlPass } from "@/lib/scene/edl";
import { createViewport } from "@/lib/scene/viewport";
import { createVoxelLayer, type VoxelLayer } from "@/lib/scene/voxel-layer";
import type { OccupiedVoxels } from "@/lib/types/octree";

export interface VoxelViewOptions {
  background: THREE.ColorRepresentation;
  /** The heights the map opens on, `[lo, hi)` metres (see bandRange). */
  band: readonly [number, number];
  /** The ground the opening view looks at, map-frame metres as drawn. */
  groundZ: number;
}

export interface VoxelViewLoop {
  /**
   * Every animation frame, before the view decides whether to draw: where a
   * surface rebuilds what its edits dirtied, calling `invalidate` if it did.
   */
  beforeFrame?: () => void;
  /** After each drawn picture, a resize's included: an overlay drawn with it. */
  afterDraw?: () => void;
  /** A frame on which the picture stood: for an overlay that changed alone. */
  idle?: () => void;
  onResize?: (width: number, height: number, pixelRatio: number) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface VoxelView {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  layer: VoxelLayer;
  edl: EdlPass;
  /** Say the picture is out of date; the next frame draws it. */
  invalidate: () => void;
  start: (loop?: VoxelViewLoop) => void;
  dispose: () => void;
}

/**
 * The map's cells on their band, framed on their ground, under the shading
 * pass. The loop draws only after `invalidate` or while the camera moves (a
 * drag, damping's coast after one): a still view is not redrawn sixty times
 * a second, which with the shading pass is two full-screen draws a frame
 * for nothing, on a robot's GPU or a phone's battery.
 */
export function createVoxelView(
  container: HTMLElement,
  voxels: OccupiedVoxels,
  { background, band, groundZ }: VoxelViewOptions,
): VoxelView {
  const viewport = createViewport(container, { background, near: 0.05 });
  const { scene, camera, renderer, controls } = viewport;

  let dirty = true;
  const invalidate = () => {
    dirty = true;
  };

  controls.enableDamping = true;
  // Any camera move the controls make themselves, beside what update() reports.
  controls.addEventListener("change", invalidate);

  const edl = createEdlPass(voxels.res);
  const layer = createVoxelLayer(voxels);
  layer.setBand(band[0], band[1]);
  scene.add(layer.points);
  frameGround(camera, controls, layer.frame, groundZ);

  const start = (loop: VoxelViewLoop = {}) => {
    const draw = () => {
      edl.render(renderer, scene, camera);
      loop.afterDraw?.();
    };
    viewport.start({
      draw,
      onResize: (width, height, pixelRatio) => {
        edl.setSize(width, height, pixelRatio);
        loop.onResize?.(width, height, pixelRatio);
      },
      onContextLost: loop.onContextLost,
      onContextRestored: loop.onContextRestored,
      frame: () => {
        loop.beforeFrame?.();
        // True while the camera moves, damping's coast included.
        if (controls.update()) dirty = true;
        if (!dirty) {
          loop.idle?.();
          return;
        }
        dirty = false;
        draw();
      },
    });
  };

  const dispose = () => {
    controls.removeEventListener("change", invalidate);
    // Their own dispose, for what the sweep cannot reach (a layer's textures).
    layer.dispose();
    edl.dispose();
    viewport.dispose();
  };

  return { scene, camera, renderer, controls, layer, edl, invalidate, start, dispose };
}
