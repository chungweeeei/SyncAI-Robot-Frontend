"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useTheme } from "next-themes";

import {
  GroundStroke,
  columnAt,
  eraseDab,
  fillDab,
  kzToMetres,
  medianFloor,
  type GroundPatch,
  type GroundSession,
} from "@/lib/map/ground-fill";
import { applyGroundControls, dollyStep, frameGround } from "@/lib/scene/camera";
import { createEdlPass, type EdlPass } from "@/lib/scene/edl";
import { createPatchLayer, type PatchLayer } from "@/lib/scene/ground-patch-layer";
import { aimRaycaster } from "@/lib/scene/picking";
import { THEMES } from "@/lib/scene/theme";
import { createVoxelLayer, type VoxelLayer } from "@/lib/scene/voxel-layer";
import { SIGNAL } from "@/lib/theme/signal";
import { cn } from "@/lib/utils";

export type GroundTool = "orbit" | "fill" | "erase";

interface Column {
  x: number;
  y: number;
}

export interface GroundCanvasProps {
  session: GroundSession;
  tool: GroundTool;
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
  className?: string;
}

/** The ring's line, as a fraction of its radius. */
const RING_WIDTH = 0.12;

/**
 * The ground editor's surface: the 3D map in 3D, orbited freely, and a
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
 */
export function GroundCanvas(props: GroundCanvasProps) {
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
    edl: EdlPass;
  } | null>(null);
  /** The brush's aim, metres: the shown floor's height. */
  const planeZRef = React.useRef(0);
  /** Set when the patches changed and the marks are not yet rebuilt. */
  const patchesDirtyRef = React.useRef(true);
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
  }, []);

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
    const edl = createEdlPass();
    edl.enabled = propsRef.current.shading;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    applyGroundControls(controls, propsRef.current.tool !== "orbit");

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

    aimAtFloor();
    frameGround(camera, controls, layer.frame, planeZRef.current);
    sceneRef.current = { scene, camera, controls, layer, brush, edl };

    let patches: PatchLayer | null = null;
    patchesDirtyRef.current = true;

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
      }
      controls.update();
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
      controls.dispose();
      scene.remove(layer.points);
      layer.dispose();
      if (patches) {
        scene.remove(patches.points);
        patches.dispose();
      }
      brush.geometry.dispose();
      brush.material.dispose();
      edl.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
    };
  }, [session, theme, aimAtFloor]);

  // ---- Shading follows its toggle -----------------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx) ctx.edl.enabled = props.shading;
  }, [props.shading]);

  // ---- Controls follow the tool ------------------------------------------
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (ctx) applyGroundControls(ctx.controls, props.tool !== "orbit");
    if (ctx && props.tool === "orbit") ctx.brush.visible = false;
  }, [props.tool]);

  // ---- Heights shown, and the floor the brush aims at -------------------
  const { lo: bandLo, hi: bandHi } = props.band;
  React.useEffect(() => {
    sceneRef.current?.layer.setBand(bandLo, bandHi);
    aimAtFloor();
  }, [bandLo, bandHi, aimAtFloor]);

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
  }, [props.zoomStep]);

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
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const { tool } = propsRef.current;
    if (tool === "orbit" || event.button !== 0 || gestureRef.current) return;
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
    if (gestureRef.current) return;
    const ctx = sceneRef.current;
    if (ctx) ctx.brush.visible = false;
  };

  return (
    <div
      ref={containerRef}
      data-testid="ground-canvas"
      role="application"
      aria-label="The 3D map. Drag to orbit; with Fill or Erase armed, drag to paint."
      className={cn(
        "absolute inset-0 touch-none",
        props.tool === "orbit" ? "cursor-grab active:cursor-grabbing" : "cursor-crosshair",
        props.className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onPointerLeave={handlePointerLeave}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
