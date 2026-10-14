"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useTheme } from "next-themes";

import type { GroundEdits } from "@/lib/map/ground-fill";
import { applyFreeOrbit, dollyStep, frameMap } from "@/lib/scene/camera";
import { createPatchLayer } from "@/lib/scene/ground-patch-layer";
import { THEMES } from "@/lib/scene/theme";
import { createVoxelLayer, type VoxelLayer } from "@/lib/scene/voxel-layer";
import { SIGNAL } from "@/lib/theme/signal";
import type { OccupiedVoxels } from "@/lib/types/octree";

/**
 * The ground editor's 3D view: the same tree and the same patches as the 2D
 * surface, to look around rather than to paint on. Painting stays in 2D
 * because a brush there lands on one column by construction; in 3D a press
 * would have to be cast onto whatever is nearest, and a wall in front of a
 * hole would take the stroke.
 *
 * Its own small scene rather than the dashboard's canvas: none of the
 * robot, pose, goal or stream machinery belongs here. `edits` is the
 * session's live map, read again whenever `editsVersion` moves; `band` is
 * the heights the 2D surface shows, so the two views agree on a floor.
 */
export function Ground3dView({
  voxels,
  edits,
  editsVersion,
  band,
  fitNonce,
  zoomStep,
}: {
  voxels: OccupiedVoxels;
  edits: GroundEdits;
  editsVersion: number;
  /** `[lo, hi)` metres by cell centre. */
  band: { lo: number; hi: number };
  fitNonce: number;
  zoomStep: { factor: number } | null;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const sceneRef = React.useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    layer: VoxelLayer;
  } | null>(null);
  const bandRef = React.useRef(band);
  const fit = React.useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx) frameMap(ctx.camera, ctx.controls, ctx.layer.frame);
  }, []);

  // ---- Scene (rebuilds on a new tree or theme) ---------------------------
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(THEMES[theme].background);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 2000);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    applyFreeOrbit(controls);
    controls.enableDamping = true;

    const layer = createVoxelLayer(voxels);
    layer.setBand(bandRef.current.lo, bandRef.current.hi);
    scene.add(layer.points);
    frameMap(camera, controls, layer.frame);
    sceneRef.current = { scene, camera, controls, layer };

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      // Draw now: setSize clears the canvas (see Realtime in CLAUDE.md).
      renderer.render(scene, camera);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let frame = 0;
    const loop = () => {
      frame = requestAnimationFrame(loop);
      controls.update();
      renderer.render(scene, camera);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      scene.remove(layer.points);
      layer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [voxels, theme]);

  // ---- Patches (rebuilt on every stroke, undo or redo) -------------------
  // Lists the scene's rebuild deps so a new scene gets them again.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    const layer = createPatchLayer(edits, voxels, SIGNAL[theme].cmd);
    ctx.scene.add(layer.points);
    return () => {
      ctx.scene.remove(layer.points);
      layer.dispose();
    };
  }, [edits, editsVersion, voxels, theme]);

  // ---- Heights shown ------------------------------------------------------
  React.useEffect(() => {
    bandRef.current = band;
    sceneRef.current?.layer.setBand(band.lo, band.hi);
  }, [band]);

  // ---- Fit and zoom (one-shot) -------------------------------------------
  React.useEffect(() => {
    if (fitNonce) fit();
  }, [fitNonce, fit]);
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx && zoomStep) dollyStep(ctx.camera, ctx.controls, zoomStep.factor);
  }, [zoomStep]);

  return (
    <div
      ref={containerRef}
      data-testid="ground-3d-view"
      role="img"
      aria-label="The 3D map in 3D, with the ground patches"
      className="absolute inset-0 touch-none"
    />
  );
}
