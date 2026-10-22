"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useTheme } from "next-themes";

import { drawnGround } from "@/lib/map/floors";
import { headingDegrees, isDrag } from "@/lib/map/gesture";
import { columnAt, kzToMetres, medianFloor } from "@/lib/map/ground";
import {
  GroundStroke,
  eraseDab,
  fillDab,
  type GroundPatch,
  type GroundSession,
} from "@/lib/map/ground-fill";
import { applyMap3dControls, dollyStep, frameGround } from "@/lib/scene/camera";
import { createEdlPass, type EdlPass } from "@/lib/scene/edl";
import { createPatchLayer, type PatchLayer } from "@/lib/scene/ground-patch-layer";
import { createPoseMarker, placePoseMarker } from "@/lib/scene/markers";
import { aimRaycaster } from "@/lib/scene/picking";
import { THEMES } from "@/lib/scene/theme";
import { createVertexLayer, type VertexLayer } from "@/lib/scene/vertex-layer";
import { createVoxelLayer, type VoxelLayer } from "@/lib/scene/voxel-layer";
import { SIGNAL } from "@/lib/theme/signal";
import { cn } from "@/lib/utils";
import type { MapVertex } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

/** Orbit, the two brushes, and Waypoint: put a stop down, or a re-placed one back. */
export type Map3dTool = "orbit" | "fill" | "erase" | "waypoint";

interface Column {
  x: number;
  y: number;
}

export interface Map3dCanvasProps {
  session: GroundSession;
  tool: Map3dTool;
  /** Brush radius in cells. */
  radius: number;
  /** How far past the brush the floor median reads, cells. */
  ring: number;
  /** The clearance band a hole must be empty through, cells. */
  clearance: number;
  /**
   * The heights shown, `[lo, hi)` metres by cell centre. The session's
   * floors follow the same band (setGroundBand), and the brush aims at the
   * floor they mostly stand on, so a change here moves both.
   */
  band: { lo: number; hi: number };
  /** Moves whenever the patches change outside a stroke: an undo, a redo, a load. */
  editsVersion: number;
  fitNonce: number;
  zoomStep: { factor: number } | null;
  /** Eye-dome lighting on the 3D map (lib/scene/edl.ts): outlines by depth. */
  shading: boolean;
  onStrokeCommit: (patch: GroundPatch) => void;
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

/** The ring's line, as a fraction of its radius. */
const RING_WIDTH = 0.12;

/**
 * The 3D view's surface: the 3D map in 3D, orbited freely, and a
 * brush that paints floor into it. A press is cast onto the height the
 * shown floor mostly stands on (`medianFloor`) rather than onto the cells,
 * because a hole has no cell to hit and a wall in front of one would take
 * the stroke; the column under that point is then dabbed by the same fill
 * rule as ever (lib/map/ground-fill.ts), which sets each patch at the floor
 * around it, not at the aim's height.
 *
 * One gesture at a time, gated on the pointer that started it. A stroke
 * turns the camera controls off for its length, so a second finger landing
 * mid-stroke cannot move the map under the cells being painted; with no
 * stroke, two fingers are OrbitControls' pan and pinch.
 *
 * Waypoint is the dashboard's placing gesture (pointcloud-canvas.tsx): a
 * press plants the stop, a drag past the deadzone aims it, and only a
 * deliberate release commits — a second finger or a cancel abandons it. With
 * no tool armed, a tap on a stop opens it.
 */
export function Map3dCanvas(props: Map3dCanvasProps) {
  const { session } = props;
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
    brush: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
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
  /** The brush's aim, metres: the shown floor's height. */
  const planeZRef = React.useRef(0);
  /** Set when the patches changed and the marks are not yet rebuilt. */
  const patchesDirtyRef = React.useRef(true);
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
  const strokeRef = React.useRef(new GroundStroke());
  const gestureRef = React.useRef<{ pointerId: number; last: Column; erase: boolean } | null>(
    null,
  );
  const raycasterRef = React.useRef(new THREE.Raycaster());

  /** Recompute the brush's aim from the session's floors (which follow the band). */
  const aimAtFloor = React.useCallback(() => {
    const f = medianFloor(session.floors);
    planeZRef.current = kzToMetres(f ?? session.band.lo, session.voxels);
  }, [session]);

  const fit = React.useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx) frameGround(ctx.camera, ctx.controls, ctx.layer.frame, planeZRef.current);
    invalidate();
  }, [invalidate]);

  // ---- Scene (rebuilds on a new tree or theme) ---------------------------
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const { voxels } = session;

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
    applyMap3dControls(controls, propsRef.current.tool !== "orbit");

    const layer = createVoxelLayer(voxels);
    const { band } = propsRef.current;
    layer.setBand(band.lo, band.hi);
    scene.add(layer.points);

    // The brush's footprint on the floor it aims at. Drawn over everything,
    // since the floor's own cells would otherwise hide it.
    const brush = new THREE.Mesh(
      new THREE.RingGeometry(1 - RING_WIDTH, 1, 48),
      // No depth either, so the shading does not outline it as a step.
      new THREE.MeshBasicMaterial({
        transparent: true,
        opacity: 0.9,
        depthTest: false,
        depthWrite: false,
      }),
    );
    brush.renderOrder = 1;
    brush.visible = false;
    scene.add(brush);

    // The waypoint being placed, in the dashboard's draft hue. Over
    // everything, like the brush, so the floor's cells do not swallow it.
    const draft = createPoseMarker(THEMES[theme].goalDraft, 0.85);
    draft.traverse((object) => {
      object.renderOrder = 1;
      const material = (object as THREE.Mesh).material as THREE.Material | undefined;
      if (material) material.depthTest = false;
    });
    scene.add(draft);

    aimAtFloor();
    frameGround(camera, controls, layer.frame, planeZRef.current);
    sceneRef.current = { scene, camera, controls, layer, brush, draft, edl };

    let patches: PatchLayer | null = null;
    patchesDirtyRef.current = true;
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
      if (patchesDirtyRef.current) {
        // Once per frame however many dabs landed in it.
        patchesDirtyRef.current = false;
        if (patches) {
          scene.remove(patches.points);
          patches.dispose();
        }
        patches = createPatchLayer(session.edits, voxels, SIGNAL[theme].cmd);
        scene.add(patches.points);
        frameDirtyRef.current = true;
      }
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
      if (patches) {
        scene.remove(patches.points);
        patches.dispose();
      }
      brush.geometry.dispose();
      brush.material.dispose();
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
  }, [session, theme, aimAtFloor, invalidate]);

  // ---- Shading follows its toggle -----------------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx) ctx.edl.enabled = props.shading;
    invalidate();
  }, [props.shading, invalidate]);

  // ---- Controls follow the tool ------------------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx) applyMap3dControls(ctx.controls, props.tool !== "orbit");
    if (ctx && (props.tool === "orbit" || props.tool === "waypoint")) ctx.brush.visible = false;
    // Disarming mid-press must not strand a planted stop.
    if (props.tool !== "waypoint") {
      anchorRef.current = null;
      draftRef.current = null;
      if (ctx) ctx.draft.visible = false;
    }
    invalidate();
  }, [props.tool, invalidate]);

  // ---- Stored waypoints ---------------------------------------------------
  // Lists the scene's rebuild deps (session, theme) so it is re-added to a
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
  }, [vertices, session, theme, invalidate]);

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

  // ---- Heights shown, and the floor the brush aims at -------------------
  const { lo: bandLo, hi: bandHi } = props.band;
  React.useEffect(() => {
    sceneRef.current?.layer.setBand(bandLo, bandHi);
    aimAtFloor();
    invalidate();
  }, [bandLo, bandHi, aimAtFloor, invalidate]);

  // ---- Patches changed outside a stroke ----------------------------------
  React.useEffect(() => {
    patchesDirtyRef.current = true;
  }, [props.editsVersion]);

  // ---- Fit and zoom (one-shot) -------------------------------------------
  React.useEffect(() => {
    if (props.fitNonce) fit();
  }, [props.fitNonce, fit]);
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx && props.zoomStep) dollyStep(ctx.camera, ctx.controls, props.zoomStep.factor);
    invalidate();
  }, [props.zoomStep, invalidate]);

  /** The point on the brush's floor under the pointer, metres, or null. */
  const cast = (event: React.PointerEvent): THREE.Vector3 | null => {
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
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -planeZRef.current);
    return raycaster.ray.intersectPlane(plane, new THREE.Vector3());
  };

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
    return hit && columnAt(session.voxels, hit.x, hit.y) ? hit : null;
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

  const columnOfHit = (hit: THREE.Vector3 | null): Column | null =>
    hit ? columnAt(session.voxels, hit.x, hit.y) : null;

  const dab = (column: Column, erase: boolean) => {
    const { radius, ring, clearance } = propsRef.current;
    const changed = erase
      ? eraseDab(session.floors, session.edits, strokeRef.current, column.x, column.y, radius)
      : fillDab(
          session.floors,
          session.edits,
          strokeRef.current,
          column.x,
          column.y,
          radius,
          ring,
          clearance,
        );
    if (changed.length > 0) patchesDirtyRef.current = true;
  };

  /** Every column on the line between two samples, so a flick leaves no gap. */
  const dabLine = (from: Column, to: Column, erase: boolean) => {
    let { x, y } = from;
    const dx = Math.abs(to.x - x);
    const dy = Math.abs(to.y - y);
    const sx = x < to.x ? 1 : -1;
    const sy = y < to.y ? 1 : -1;
    let error = dx - dy;
    for (;;) {
      dab({ x, y }, erase);
      if (x === to.x && y === to.y) return;
      const e2 = 2 * error;
      if (e2 > -dy) {
        error -= dy;
        x += sx;
      }
      if (e2 < dx) {
        error += dx;
        y += sy;
      }
    }
  };

  /** Move the brush ring onto the column under the pointer. */
  const hover = (hit: THREE.Vector3 | null, erase: boolean) => {
    const ctx = sceneRef.current;
    const { tool, radius } = propsRef.current;
    const column = columnOfHit(hit);
    if (ctx) {
      ctx.brush.visible = tool !== "orbit" && column !== null;
      if (hit && column) {
        const r = (radius + 0.5) * session.voxels.res;
        ctx.brush.position.set(hit.x, hit.y, planeZRef.current);
        ctx.brush.scale.set(r, r, 1);
        ctx.brush.material.color.set(erase ? SIGNAL[theme].warn : SIGNAL[theme].cmd);
      }
      invalidate();
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const { tool } = propsRef.current;
    if (tool === "orbit") {
      // Maybe a tap on a stop, resolved on release so a drag starting on a
      // marker still orbits. Primary only: a second finger is a pinch.
      tapRef.current =
        event.button === 0 && event.isPrimary
          ? { pointerId: event.pointerId, cx: event.clientX, cy: event.clientY }
          : null;
      return;
    }
    if (tool === "waypoint") {
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
      return;
    }
    if (event.button !== 0 || gestureRef.current) return;
    if (event.pointerType === "touch" && !event.isPrimary) return;
    const hit = cast(event);
    const column = columnOfHit(hit);
    if (!column) return;
    // No capture of our own: OrbitControls has already captured this
    // pointer on its canvas, and taking it away would leave the controls
    // holding a pointer whose release they never see. The canvas's events
    // bubble here.
    event.preventDefault();
    // Shift erases with Fill armed, the viewer's habit; a finger has no Shift.
    const erase = tool === "erase" || event.shiftKey;
    gestureRef.current = { pointerId: event.pointerId, last: column, erase };
    const ctx = sceneRef.current;
    if (ctx) ctx.controls.enabled = false;
    dab(column, erase);
    hover(hit, erase);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const { tool } = propsRef.current;
    if (tool === "orbit") {
      // Hover-test only with no button down; a button down is a camera drag.
      if (event.buttons === 0) hoverVertex(pickVertex(event));
      return;
    }
    if (tool === "waypoint") {
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
      return;
    }
    const gesture = gestureRef.current;
    if (gesture && gesture.pointerId !== event.pointerId) return;
    const hit = cast(event);
    if (gesture) {
      const column = columnOfHit(hit);
      if (column) {
        dabLine(gesture.last, column, gesture.erase);
        gesture.last = column;
      }
    }
    hover(hit, gesture?.erase ?? (propsRef.current.tool === "erase" || event.shiftKey));
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
      return;
    }
    endGesture(event);
  };

  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tapRef.current?.pointerId === event.pointerId) tapRef.current = null;
    // Only a deliberate release may put a stop down.
    if (anchorRef.current?.pointerId === event.pointerId) {
      anchorRef.current = null;
      showDraft(null);
      return;
    }
    endGesture(event);
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    const ctx = sceneRef.current;
    if (ctx) ctx.controls.enabled = true;
    // A cancelled pointer commits too: the edits are already made, and an
    // edit undo cannot reach is worse than a short stroke.
    const patch = strokeRef.current.commit(session.edits);
    if (patch) propsRef.current.onStrokeCommit(patch);
  };

  const handlePointerLeave = () => {
    tapRef.current = null;
    hoverVertex(null);
    // A planted stop survives the pointer leaving; a carried one does not.
    if (!anchorRef.current) showDraft(null);
    if (gestureRef.current) return;
    const ctx = sceneRef.current;
    if (ctx) ctx.brush.visible = false;
    invalidate();
  };

  return (
    <div
      ref={containerRef}
      data-testid="ground-canvas"
      role="application"
      aria-label="The 3D map. Drag to orbit; with Fill or Erase armed, drag to paint; with Waypoint armed, press to place and drag to aim."
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
