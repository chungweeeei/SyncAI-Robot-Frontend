// The part of a 3D view every surface builds the same way: renderer, z-up
// camera, orbit controls, sizing, the frame loop and teardown. What a surface
// puts in the scene and when it redraws stay its own.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface ViewportOptions {
  background: THREE.ColorRepresentation;
  /** The camera's near plane, metres. */
  near: number;
}

export interface ViewportLoop {
  /** Called once per animation frame with the seconds since the last one. */
  frame: (dt: number) => void;
  /**
   * Draw one frame now. The viewport calls it after every resize and after a
   * lost GPU context comes back, when the canvas would otherwise stay blank.
   */
  draw: () => void;
  /** After the renderer and camera took the container's new size. */
  onResize?: (width: number, height: number, pixelRatio: number) => void;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface Viewport {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  /** Size to the container, follow it, and run `loop` until dispose(). */
  start: (loop: ViewportLoop) => void;
  /**
   * Stop the loop, free the renderer and every geometry and material in the
   * scene, and take the canvas out of the container. Detach anything shared
   * between mounts (a cached model) from the scene first, or this frees it.
   */
  dispose: () => void;
}

export function createViewport(
  container: HTMLElement,
  { background, near }: ViewportOptions,
): Viewport {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(background);

  // z-up world so ROS map coordinates (x, y, z) map straight through.
  const camera = new THREE.PerspectiveCamera(60, 1, near, 2000);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  container.appendChild(canvas);

  const controls = new OrbitControls(camera, canvas);
  // OrbitControls writes touch-action: none inline, which stops a swipe
  // scrolling the page below lg. Cleared so the container's class decides.
  canvas.style.touchAction = "";

  let raf = 0;
  let observer: ResizeObserver | null = null;
  let unwatch: (() => void) | null = null;

  const start = (loop: ViewportLoop) => {
    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      loop.onResize?.(rect.width, rect.height, renderer.getPixelRatio());
      // Draw now: setSize clears the canvas and the observer fires after this
      // frame's render, so without it the cleared canvas is painted.
      loop.draw();
    };
    resize();
    observer = new ResizeObserver(resize);
    observer.observe(container);

    // three.js already calls preventDefault on a loss, which is what lets the
    // browser give the context back, and re-uploads every buffer on the next
    // render after it does. What it cannot do is tell anyone: a view whose
    // context never returns just stays black. These are how a surface finds out.
    const lost = () => loop.onContextLost?.();
    const restored = () => {
      loop.onContextRestored?.();
      loop.draw();
    };
    canvas.addEventListener("webglcontextlost", lost);
    canvas.addEventListener("webglcontextrestored", restored);
    unwatch = () => {
      canvas.removeEventListener("webglcontextlost", lost);
      canvas.removeEventListener("webglcontextrestored", restored);
    };

    let prev = performance.now();
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now();
      const dt = (now - prev) / 1000;
      prev = now;
      loop.frame(dt);
    };
    raf = requestAnimationFrame(tick);
  };

  const dispose = () => {
    cancelAnimationFrame(raf);
    observer?.disconnect();
    unwatch?.();
    controls.dispose();
    disposeTree(scene);
    renderer.dispose();
    canvas.remove();
  };

  return { scene, camera, renderer, controls, start, dispose };
}

/**
 * Free every geometry and material under `root`. A material's textures are
 * not reached — disposing a material does not free its `.map` — so whoever
 * loaded one frees it by hand.
 */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) material.forEach((m) => m.dispose());
    else material?.dispose();
  });
}
