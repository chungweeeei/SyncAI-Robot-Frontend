"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useTheme } from "next-themes";

import { drawnGround } from "@/lib/map/floors";
import { headingDegrees, isDrag } from "@/lib/map/gesture";
import { columnAt } from "@/lib/map/ground";
import { applyMap3dControls, dollyStep, frameGround } from "@/lib/scene/camera";
import { createEdlPass, type EdlPass } from "@/lib/scene/edl";
import { createPoseMarker, placePoseMarker } from "@/lib/scene/markers";
import { aimRaycaster } from "@/lib/scene/picking";
import { THEMES } from "@/lib/scene/theme";
import { createVertexLayer, type VertexLayer } from "@/lib/scene/vertex-layer";
import { createVoxelLayer, type VoxelLayer } from "@/lib/scene/voxel-layer";
import { cn } from "@/lib/utils";
import type { MapVertex } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import type { PlanarPose } from "@/lib/types/robot";

/** Orbit, and Waypoint: put a stop down, or a re-placed one back. */
export type Map3dTool = "orbit" | "waypoint";

export interface Map3dCanvasProps {
  voxels: OccupiedVoxels;
  tool: Map3dTool;
  /** The heights shown, `[lo, hi)` metres by cell centre. */
  band: { lo: number; hi: number };
  /**
   * The height Fit frames the view on, metres: the floor the shown heights
   * mostly stand on, so the middle of the screen is the middle of the map
   * at the height the robot walks.
   */
  frameZ: number;
  fitNonce: number;
  zoomStep: { factor: number } | null;
  /** Eye-dome lighting on the 3D map (lib/scene/edl.ts): outlines by depth. */
  shading: boolean;
  /** The map's stored waypoints. */
  vertices: MapVertex[];
  /**
   * The floor picked, by ground height `[lo, hi)`: only its stops are shown
   * or tappable, the dashboard's rule. Null shows every floor's.
   */
  vertexBand: { lo: number; hi: number } | null;
  /** The stop being re-placed, taken off the map while it is in hand. */
  movingVertex: MapVertex | null;
  /**
   * The ground a Waypoint press is cast onto, as the wire writes it (0 is
   * the ground floor; see `drawnGround`). The height the stop is stored at
   * is the caller's (`placedGround`): this is only the plane under the aim.
   */
  placeZ: number;
  /** A deliberate release with Waypoint armed: where and which way. */
  onPlaceCommit: (pose: PlanarPose) => void;
  /** A tap on a stored stop with no tool armed. */
  onVertexActivate: (vertex: MapVertex) => void;
  className?: string;
}

/**
 * The 3D map page's surface: the 3D map in 3D, orbited freely, and the
 * map's waypoints on it.
 *
 * Waypoint is the dashboard's placing gesture (pointcloud-canvas.tsx): a
 * press plants the stop, a drag past the deadzone aims it, and only a
 * deliberate release commits — a second finger or a cancel abandons it. With
 * no tool armed, a tap on a stop opens it; two fingers are OrbitControls'
 * pan and pinch either way.
 */
export function Map3dCanvas(props: Map3dCanvasProps) {
  const { voxels } = props;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";

  const propsRef = React.useRef(props);
  React.useLayoutEffect(() => {
    propsRef.current = props;
  });

  const sceneRef = React.useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    layer: VoxelLayer;
    draft: THREE.Group;
    edl: EdlPass;
  } | null>(null);
  const vertexLayerRef = React.useRef<VertexLayer | null>(null);
  /** A Waypoint press planted and not yet released: where, and where on screen. */
  const anchorRef = React.useRef<{
    pointerId: number;
    wx: number;
    wy: number;
    cx: number;
    cy: number;
  } | null>(null);
  /** The pose the draft marker shows: carried under the pointer, or planted and aimed. */
  const draftRef = React.useRef<PlanarPose | null>(null);
  /** A press with no tool armed that may still be a tap on a stop. */
  const tapRef = React.useRef<{ pointerId: number; cx: number; cy: number } | null>(null);
  const [hovering, setHovering] = React.useState(false);
  /**
   * Set when the picture is out of date. The loop draws only then, or while
   * the camera moves (a drag, damping's coast after one): a still view is
   * not redrawn sixty times a second, which with the shading pass is two
   * full-screen draws a frame for nothing, on a robot's GPU or a phone's
   * battery.
   */
  const frameDirtyRef = React.useRef(true);
  const invalidate = React.useCallback(() => {
    frameDirtyRef.current = true;
  }, []);
  const raycasterRef = React.useRef(new THREE.Raycaster());

  const fit = React.useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx) frameGround(ctx.camera, ctx.controls, ctx.layer.frame, propsRef.current.frameZ);
    invalidate();
  }, [invalidate]);

  // ---- Scene (rebuilds on a new tree or theme) ---------------------------
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(THEMES[theme].background);
    const camera = new THREE.PerspectiveCamera(60, 1, 0.05, 2000);
    camera.up.set(0, 0, 1);
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    renderer.domElement.style.display = "block";
    container.appendChild(renderer.domElement);
    const edl = createEdlPass(voxels.res);
    edl.enabled = propsRef.current.shading;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    // Any camera move the controls make themselves, beside what update() reports.
    controls.addEventListener("change", invalidate);
    applyMap3dControls(controls, propsRef.current.tool === "waypoint");

    const layer = createVoxelLayer(voxels);
    const { band } = propsRef.current;
    layer.setBand(band.lo, band.hi);
    scene.add(layer.points);

    // The waypoint being placed, in the dashboard's draft hue. Drawn over
    // everything, so the floor's cells do not swallow it.
    const draft = createPoseMarker(THEMES[theme].goalDraft, 0.85);
    draft.traverse((object) => {
      object.renderOrder = 1;
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material) material.depthTest = false;
    });
    scene.add(draft);

    frameGround(camera, controls, layer.frame, propsRef.current.frameZ);
    sceneRef.current = { scene, camera, controls, layer, draft, edl };
    frameDirtyRef.current = true;

    const resize = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      renderer.setSize(rect.width, rect.height, false);
      edl.setSize(rect.width, rect.height, renderer.getPixelRatio());
      camera.aspect = rect.width / rect.height;
      camera.updateProjectionMatrix();
      // Draw now: setSize clears the canvas (see Realtime in CLAUDE.md).
      edl.render(renderer, scene, camera);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    let frame = 0;
    let distance = "";
    const loop = () => {
      frame = requestAnimationFrame(loop);
      // True while the camera moves, damping's coast included.
      if (controls.update()) frameDirtyRef.current = true;
      if (!frameDirtyRef.current) return;
      frameDirtyRef.current = false;
      // What the phone test reads a pinch off: the camera's distance to its
      // target, in centimetres, written only when it moves.
      const next = String(Math.round(camera.position.distanceTo(controls.target) * 100));
      if (next !== distance) {
        distance = next;
        container.dataset.distance = next;
      }
      edl.render(renderer, scene, camera);
    };
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.removeEventListener("change", invalidate);
      controls.dispose();
      scene.remove(layer.points);
      layer.dispose();
      draft.traverse((object) => {
        const mesh = object as THREE.Mesh;
        mesh.geometry?.dispose();
        (mesh.material as THREE.Material | undefined)?.dispose();
      });
      edl.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [voxels, theme, invalidate]);

  // ---- Shading follows its toggle -----------------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx) ctx.edl.enabled = props.shading;
    invalidate();
  }, [props.shading, invalidate]);

  // ---- Controls follow the tool ------------------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx) applyMap3dControls(ctx.controls, props.tool === "waypoint");
    // Disarming mid-press must not strand a planted stop.
    if (props.tool !== "waypoint") {
      anchorRef.current = null;
      draftRef.current = null;
      if (ctx) ctx.draft.visible = false;
    }
    invalidate();
  }, [props.tool, invalidate]);

  // ---- Stored waypoints ---------------------------------------------------
  // Lists the scene's rebuild deps (voxels, theme) so it is re-added to a
  // rebuilt scene; its own cleanup removes it.
  const { vertices, vertexBand, movingVertex } = props;
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || vertices.length === 0) return;
    const layer = createVertexLayer(vertices, THEMES[theme]);
    ctx.scene.add(layer.group);
    vertexLayerRef.current = layer;
    const { vertexBand: band, movingVertex: moving } = propsRef.current;
    layer.setBand(band?.lo ?? -Infinity, band?.hi ?? Infinity);
    layer.setMoving(moving?.id ?? null);
    invalidate();
    return () => {
      ctx.scene.remove(layer.group);
      // The badge textures are not reached by any scene teardown.
      layer.dispose();
      vertexLayerRef.current = null;
      invalidate();
    };
  }, [vertices, voxels, theme, invalidate]);

  const vertexLo = vertexBand?.lo ?? -Infinity;
  const vertexHi = vertexBand?.hi ?? Infinity;
  React.useEffect(() => {
    vertexLayerRef.current?.setBand(vertexLo, vertexHi);
    invalidate();
  }, [vertexLo, vertexHi, invalidate]);

  // Its own effect so arming a re-place does not rebuild the layer.
  React.useEffect(() => {
    vertexLayerRef.current?.setMoving(movingVertex?.id ?? null);
    invalidate();
  }, [movingVertex, invalidate]);

  // ---- Heights shown ------------------------------------------------------
  const { lo: bandLo, hi: bandHi } = props.band;
  React.useEffect(() => {
    sceneRef.current?.layer.setBand(bandLo, bandHi);
    invalidate();
  }, [bandLo, bandHi, invalidate]);

  // ---- Fit and zoom (one-shot) -------------------------------------------
  React.useEffect(() => {
    if (props.fitNonce) fit();
  }, [props.fitNonce, fit]);
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx && props.zoomStep) dollyStep(ctx.camera, ctx.controls, props.zoomStep.factor);
    invalidate();
  }, [props.zoomStep, invalidate]);

  /** The point on the waypoint's ground under the pointer, metres, or null off the tree. */
  const castPlace = (event: { clientX: number; clientY: number }) => {
    const ctx = sceneRef.current;
    const container = containerRef.current;
    if (!ctx || !container) return null;
    const raycaster = raycasterRef.current;
    aimRaycaster(
      raycaster,
      ctx.camera,
      container.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const z = drawnGround(propsRef.current.placeZ);
    const hit = raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z),
      new THREE.Vector3(),
    );
    // Off the tree's box is nowhere the robot has been.
    return hit && columnAt(voxels, hit.x, hit.y) ? hit : null;
  };

  /** The stored stop under a pointer position, or null (also another floor's). */
  const pickVertex = (event: { clientX: number; clientY: number }) => {
    const ctx = sceneRef.current;
    const layer = vertexLayerRef.current;
    const container = containerRef.current;
    if (!ctx || !layer || !container) return null;
    const raycaster = raycasterRef.current;
    aimRaycaster(
      raycaster,
      ctx.camera,
      container.getBoundingClientRect(),
      event.clientX,
      event.clientY,
    );
    const hit = raycaster.intersectObjects(layer.pickables, false)[0];
    const id = hit?.object.userData.vertexId as string | undefined;
    return id ? (layer.byId.get(id) ?? null) : null;
  };

  /** Show the draft marker at a pose, or hide it. */
  const showDraft = (pose: PlanarPose | null) => {
    draftRef.current = pose;
    const ctx = sceneRef.current;
    if (!ctx) return;
    placePoseMarker(ctx.draft, pose && { ...pose, z: propsRef.current.placeZ });
    invalidate();
  };

  /** A re-place keeps the stop's own heading until a drag aims it; a new one faces +x. */
  const seedTheta = () => draftRef.current?.theta ?? propsRef.current.movingVertex?.theta ?? 0;

  const hoverVertex = (vertex: MapVertex | null) => {
    vertexLayerRef.current?.setHovered(vertex?.id ?? null);
    setHovering(vertex !== null);
    invalidate();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (propsRef.current.tool === "orbit") {
      // Maybe a tap on a stop, resolved on release so a drag starting on a
      // marker still orbits. Primary only: a second finger is a pinch.
      tapRef.current =
        event.button === 0 && event.isPrimary
          ? { pointerId: event.pointerId, cx: event.clientX, cy: event.clientY }
          : null;
      return;
    }
    if (event.button !== 0) return;
    // A second finger is a pinch, never a second stop, and the first
    // finger's lift must not then commit what it was aiming.
    if (anchorRef.current || !event.isPrimary) {
      anchorRef.current = null;
      showDraft(null);
      return;
    }
    const hit = castPlace(event);
    if (!hit) return;
    event.preventDefault();
    anchorRef.current = {
      pointerId: event.pointerId,
      wx: hit.x,
      wy: hit.y,
      cx: event.clientX,
      cy: event.clientY,
    };
    showDraft({ x: hit.x, y: hit.y, theta: seedTheta() });
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (propsRef.current.tool === "orbit") {
      // Hover-test only with no button down; a button down is a camera drag.
      if (event.buttons === 0) hoverVertex(pickVertex(event));
      return;
    }
    if (!event.isPrimary) return;
    const anchor = anchorRef.current;
    if (!anchor) {
      // Carried under the pointer until a press plants it; off the tree, none.
      const hit = castPlace(event);
      showDraft(hit ? { x: hit.x, y: hit.y, theta: seedTheta() } : null);
      return;
    }
    if (anchor.pointerId !== event.pointerId) return;
    let theta = seedTheta();
    if (isDrag(anchor.cx, anchor.cy, event.clientX, event.clientY)) {
      // World-space, not the screen delta: the camera may face any azimuth.
      const hit = castPlace(event);
      if (hit) theta = headingDegrees(hit.x - anchor.wx, hit.y - anchor.wy) ?? theta;
    }
    showDraft({ x: anchor.wx, y: anchor.wy, theta });
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const tap = tapRef.current;
    if (tap) {
      tapRef.current = null;
      if (
        propsRef.current.tool === "orbit" &&
        tap.pointerId === event.pointerId &&
        !isDrag(tap.cx, tap.cy, event.clientX, event.clientY)
      ) {
        const vertex = pickVertex(event);
        if (vertex) propsRef.current.onVertexActivate(vertex);
      }
    }
    const anchor = anchorRef.current;
    if (anchor && anchor.pointerId === event.pointerId) {
      anchorRef.current = null;
      const pose = draftRef.current;
      showDraft(null);
      if (pose) propsRef.current.onPlaceCommit(pose);
    }
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tapRef.current?.pointerId === event.pointerId) tapRef.current = null;
    // Only a deliberate release may put a stop down.
    if (anchorRef.current?.pointerId === event.pointerId) {
      anchorRef.current = null;
      showDraft(null);
    }
  };

  const handlePointerLeave = () => {
    tapRef.current = null;
    hoverVertex(null);
    // A planted stop survives the pointer leaving; a carried one does not.
    if (!anchorRef.current) showDraft(null);
  };

  return (
    <div
      ref={containerRef}
      data-testid="map-3d-canvas"
      role="application"
      aria-label="The 3D map. Drag to orbit; with Waypoint armed, press to place and drag to aim."
      className={cn(
        "absolute inset-0 touch-none",
        props.tool !== "orbit"
          ? "cursor-crosshair"
          : hovering
            ? "cursor-pointer"
            : "cursor-grab active:cursor-grabbing",
        props.className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
