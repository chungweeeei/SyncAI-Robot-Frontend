"use client";

import * as React from "react";
import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useTheme } from "next-themes";

import { GpuLostNotice } from "@/components/console/fault-panel";
import { useGpuContext } from "@/hooks/use-gpu-context";
import { drawnGround } from "@/lib/map/floors";
import { headingDegrees, isDrag } from "@/lib/map/gesture";
import { columnAt, kzToMetres, medianFloor } from "@/lib/map/ground";
import {
  GroundStroke,
  aimSurface,
  eraseDab,
  fillDab,
  patchHeight,
  type FillReach,
  type GroundPatch,
  type GroundSession,
} from "@/lib/map/ground-fill";
import { applyMap3dControls, dollyStep, frameGround } from "@/lib/scene/camera";
import { createEdlPass, type EdlPass } from "@/lib/scene/edl";
import { createPatchLayer, type PatchLayer } from "@/lib/scene/ground-patch-layer";
import { createPoseMarker, placePoseMarker } from "@/lib/scene/markers";
import { aimRaycaster } from "@/lib/scene/picking";
import { THEMES } from "@/lib/scene/theme";
import { createViewport } from "@/lib/scene/viewport";
import { createVertexLayer, type VertexLayer } from "@/lib/scene/vertex-layer";
import { createVoxelLayer, type VoxelLayer } from "@/lib/scene/voxel-layer";
import { createZoneLayer } from "@/lib/scene/zone-layer";
import { SIGNAL } from "@/lib/theme/signal";
import { cn } from "@/lib/utils";
import {
  classifyZonePress,
  cornerAt,
  zoneAt,
  zoneGround,
  zoneOnFloor,
  type ZoneAnchor,
  type ZoneCornerRef,
} from "@/lib/map/zone";
import type { MapVertex, ZonePoint, ZonePolygon } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

/**
 * Orbit, the two brushes, Waypoint (put a stop down, or a re-placed one
 * back), Move (drag a stop somewhere else), Select (tap stops into the set a
 * Delete takes), Remove (take a stored stop off the map), Zone (draw a
 * forbidden zone's corners, one tap each) and Zone remove (tap a zone to
 * delete it).
 */
export type Map3dTool =
  | "orbit"
  | "fill"
  | "erase"
  | "waypoint"
  | "move"
  | "select"
  | "remove"
  | "zone"
  | "zoneRemove";

/** The tools a tap on a forbidden zone, or on bare floor, means something to. */
const tapsZones = (tool: Map3dTool) => tool === "zone" || tool === "zoneRemove";

/**
 * How near a corner a press picks it up, CSS pixels: the floor plan editor's
 * corner targets (grid-canvas.tsx), mouse and finger. One target for every
 * corner -- the shape's first (close), a finished zone's (anchor, merge) and
 * any of them for a drag.
 */
const CORNER_RADIUS_PX = 12;
const CORNER_RADIUS_TOUCH_PX = 22;

/** The tools a tap on a stored stop means something to. */
const tapsStops = (tool: Map3dTool) => tool === "orbit" || tool === "select" || tool === "remove";

interface Column {
  x: number;
  y: number;
}

export interface Map3dCanvasProps {
  session: GroundSession;
  tool: Map3dTool;
  /** Brush radius in cells. */
  radius: number;
  /** The fill's distances at the tree's resolution (lib/map/ground-fill.ts). */
  reach: FillReach;
  /**
   * The heights shown, `[lo, hi)` metres by cell centre. The session's
   * floors follow the same band (setGroundBand); the brush aims only at
   * what is shown, and at the floor they mostly stand on when the pointer
   * is over nothing.
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
  /** A tap on a stored stop with Remove armed. */
  onVertexRemove: (vertex: MapVertex) => void;
  /** The stops lit as selected, whatever the tool. */
  selectedVertexIds: readonly string[];
  /** A tap on a stored stop with Select armed: in or out of the selection. */
  onVertexSelect: (vertex: MapVertex) => void;
  /**
   * A stop dragged with Move armed and let go: where it now stands, its
   * heading kept. Only a deliberate release past the deadzone; a tap opens it.
   */
  onVertexMove: (vertex: MapVertex, pose: PlanarPose) => void;
  /** The map's saved forbidden zones; drawn whatever the tool. */
  zones: readonly ZonePolygon[];
  /**
   * The floor picked, by ground height `[lo, hi)`: the zones of other floors
   * are hidden and untappable (a zone of every floor stays). Null shows all.
   */
  zoneFloor: { lo: number; hi: number } | null;
  /**
   * The ground a Zone tap is cast onto and a zone of every floor is drawn
   * at, map-frame metres; null aims at the floor the shown heights mostly
   * stand on, as the brush does.
   */
  zonePlaneZ: number | null;
  /** The corners of the zone being drawn, in order. */
  zoneDraft: readonly ZonePoint[];
  /** Where the shape in flight is attached to a finished zone, or null. */
  zoneAnchor: ZoneAnchor | null;
  /** A tap on bare floor with Zone armed: the next corner. */
  onZoneCorner: (point: ZonePoint) => void;
  /** A tap on the first corner once an unanchored shape can close. */
  onZoneClose: () => void;
  /**
   * A tap on a finished zone's corner with no anchor yet: the shape in flight
   * starts there (or reaches it) and will join that zone (lib/map/zone.ts).
   */
  onZoneAnchor: (corner: { zoneId: string; index: number }) => void;
  /** A tap on another corner of the anchored zone: merge the shape into it there. */
  onZoneMerge: (index: number) => void;
  /**
   * A corner dragged, live: the shape's (`zoneId` null) or a finished zone's.
   * The caller moves it on screen; Save sends it.
   */
  onZoneCornerDrag: (corner: ZoneCornerRef, point: ZonePoint) => void;
  /** A tap inside a zone with Zone remove armed. */
  onZoneRemove: (zone: ZonePolygon) => void;
  className?: string;
}

/** The ring's line, as a fraction of its radius. */
const RING_WIDTH = 0.12;

/**
 * The 3D view's surface: the 3D map in 3D, orbited freely, and a
 * brush that paints floor into it. The brush aims at the surface under the
 * pointer (`aimSurface`: a tread, a landing, the rim of the hole the pointer
 * is over) and a press is cast onto that height, so a stair is painted
 * where it is seen and not where a ray through it meets the floor picked —
 * a plane at one height put a stroke metres off a flight seen at an angle.
 * Over nothing, the brush keeps its last aim, and starts at the height the
 * shown floor mostly stands on (`medianFloor`). The columns under the point
 * are then dabbed by lib/map/ground-fill.ts, which sets each patch at the
 * surface nearest it, not at the aim's height.
 *
 * One gesture at a time, gated on the pointer that started it. A stroke
 * turns the camera controls off for its length, so a second finger landing
 * mid-stroke cannot move the map under the cells being painted; with no
 * stroke, two fingers are OrbitControls' pan and pinch.
 *
 * Waypoint is the dashboard's placing gesture (pointcloud-canvas.tsx): a
 * press plants the stop, a drag past the deadzone aims it, and only a
 * deliberate release commits — a second finger or a cancel abandons it. With
 * no tool armed, a tap on a stop opens it; with Select armed, it toggles it
 * in the selection; with Remove armed, it removes it. Move carries a stop
 * under the pointer from where it was grabbed, on its own ground, so a stop
 * picked by its badge does not jump; the same release rule commits it.
 */
export function Map3dCanvas(props: Map3dCanvasProps) {
  const { session } = props;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();
  const theme = resolvedTheme === "dark" ? "dark" : "light";
  const gpu = useGpuContext();

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
  /**
   * A press with a zone tool armed: a tap until it moves past the deadzone,
   * then a drag of the corner it landed on (`grab`), if any.
   */
  const zonePressRef = React.useRef<{
    pointerId: number;
    cx: number;
    cy: number;
    grab: ZoneCornerRef | null;
    /** The height the grabbed corner lies at, which its drag is cast onto. */
    z: number;
    dragging: boolean;
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
  /**
   * A stop grabbed with Move armed: a tap until it passes the deadzone, then
   * a drag. `dx`/`dy` is the stop's offset from the grab point on its ground.
   */
  const dragRef = React.useRef<{
    pointerId: number;
    vertex: MapVertex;
    cx: number;
    cy: number;
    dx: number;
    dy: number;
    dragging: boolean;
  } | null>(null);
  const [hovering, setHovering] = React.useState(false);
  /**
   * Set while the brush is over a place a fill has no surface to read a
   * height from, which is otherwise a stroke that silently does nothing.
   */
  const [unreadable, setUnreadable] = React.useState(false);
  /** The height the shown floor mostly stands on, metres: framing, zones. */
  const planeZRef = React.useRef(0);
  /** The brush's aim, relative kz: the surface last under the pointer. */
  const aimKzRef = React.useRef(0);
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
    const f = medianFloor(session.floors) ?? session.band.lo;
    planeZRef.current = kzToMetres(f, session.voxels);
    aimKzRef.current = f;
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

    const viewport = createViewport(container, {
      background: THEMES[theme].background,
      near: 0.05,
    });
    const { scene, camera, renderer, controls } = viewport;
    const edl = createEdlPass(voxels.res);
    edl.enabled = propsRef.current.shading;

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

    let distance = "";
    viewport.start({
      draw: () => edl.render(renderer, scene, camera),
      onResize: (width, height, pixelRatio) => edl.setSize(width, height, pixelRatio),
      onContextLost: gpu.onContextLost,
      onContextRestored: gpu.onContextRestored,
      frame: () => {
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
      },
    });

    return () => {
      controls.removeEventListener("change", invalidate);
      // Their own dispose, for what the sweep cannot reach (a layer's textures).
      layer.dispose();
      patches?.dispose();
      edl.dispose();
      viewport.dispose();
      sceneRef.current = null;
    };
  }, [session, theme, aimAtFloor, invalidate, gpu.onContextLost, gpu.onContextRestored]);

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
    if (ctx && props.tool !== "fill" && props.tool !== "erase") ctx.brush.visible = false;
    // Disarming mid-press must not strand a planted stop.
    if (props.tool !== "waypoint" && props.tool !== "move") {
      anchorRef.current = null;
      draftRef.current = null;
      if (ctx) ctx.draft.visible = false;
    }
    // Nor a stop half dragged: it goes back where it was.
    if (props.tool !== "move" && dragRef.current) {
      dragRef.current = null;
      vertexLayerRef.current?.setMoving(propsRef.current.movingVertex?.id ?? null);
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
    const { vertexBand: band, movingVertex: moving, selectedVertexIds } = propsRef.current;
    layer.setBand(band?.lo ?? -Infinity, band?.hi ?? Infinity);
    layer.setMoving(moving?.id ?? null);
    layer.setSelected(selectedVertexIds);
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

  const { selectedVertexIds } = props;
  React.useEffect(() => {
    vertexLayerRef.current?.setSelected(selectedVertexIds);
    invalidate();
  }, [selectedVertexIds, invalidate]);

  // ---- Forbidden zones ----------------------------------------------------
  // Rebuilt on any change, as on the dashboard; a map has a handful. The
  // band is a dependency because a zone of every floor is drawn at the
  // ground the shown heights stand on, which the band moves.
  const { zones, zoneFloor, zonePlaneZ, zoneDraft } = props;
  const zoneLo = zoneFloor?.lo ?? -Infinity;
  const zoneHi = zoneFloor?.hi ?? Infinity;
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || zones.length === 0) return;
    const floor = zoneLo === -Infinity && zoneHi === Infinity ? null : { lo: zoneLo, hi: zoneHi };
    const layer = createZoneLayer(zones, THEMES[theme], {
      defaultZ: zonePlaneZ ?? planeZRef.current,
      visible: (zone) => zoneOnFloor(zone, floor),
    });
    ctx.scene.add(layer.group);
    invalidate();
    return () => {
      ctx.scene.remove(layer.group);
      layer.dispose();
      invalidate();
    };
  }, [zones, zoneLo, zoneHi, zonePlaneZ, props.band.lo, props.band.hi, session, theme, invalidate]);

  // The shape in flight: its edges so far and a dot per corner, over
  // everything like the brush, so the floor's cells cannot swallow it.
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || zoneDraft.length === 0) return;
    const z = zonePlaneZ ?? planeZRef.current;
    const positions = zoneDraft.flatMap(({ x, y }) => [x, y, z]);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const color = THEMES[theme].zone;
    const lineMaterial = new THREE.LineBasicMaterial({ color, depthTest: false });
    const dotMaterial = new THREE.PointsMaterial({
      color,
      size: 8,
      sizeAttenuation: false,
      depthTest: false,
    });
    const group = new THREE.Group();
    const line = new THREE.Line(geometry, lineMaterial);
    const dots = new THREE.Points(geometry, dotMaterial);
    line.renderOrder = 3;
    dots.renderOrder = 3;
    group.add(line, dots);
    ctx.scene.add(group);
    invalidate();
    return () => {
      ctx.scene.remove(group);
      geometry.dispose();
      lineMaterial.dispose();
      dotMaterial.dispose();
      invalidate();
    };
  }, [zoneDraft, zonePlaneZ, props.band.lo, props.band.hi, session, theme, invalidate]);

  // The finished zones' corners, as dots, while Zone is armed: what a press
  // anchors a shape on, merges it at, or drags. The floor plan shows them
  // the same way.
  const zoneTool = props.tool === "zone";
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx || !zoneTool || zones.length === 0) return;
    const floor = zoneLo === -Infinity && zoneHi === Infinity ? null : { lo: zoneLo, hi: zoneHi };
    const plane = zonePlaneZ ?? planeZRef.current;
    const positions = zones
      .filter((zone) => zoneOnFloor(zone, floor))
      .flatMap((zone) => {
        const z = zoneGround(zone) ?? plane;
        return zone.points.flatMap(({ x, y }) => [x, y, z]);
      });
    if (positions.length === 0) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({
      color: THEMES[theme].zone,
      size: 7,
      sizeAttenuation: false,
      depthTest: false,
    });
    const dots = new THREE.Points(geometry, material);
    dots.renderOrder = 3;
    ctx.scene.add(dots);
    invalidate();
    return () => {
      ctx.scene.remove(dots);
      geometry.dispose();
      material.dispose();
      invalidate();
    };
  }, [zoneTool, zones, zoneLo, zoneHi, zonePlaneZ, props.band.lo, props.band.hi, session, theme, invalidate]);

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

  /**
   * The point under the pointer on the surface the brush aims at, metres,
   * or null; re-aims the brush on the way. The aim reaches a cell past the
   * brush's edge, so a pointer over a hole the brush covers finds its rim.
   */
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
    const { voxels, stacks, edits, band } = session;
    const reach = (propsRef.current.radius + 1) * voxels.res;
    const aim = aimSurface(voxels, stacks, edits, band, raycaster.ray, reach);
    if (aim !== null) aimKzRef.current = aim;
    const z = kzToMetres(aimKzRef.current, voxels);
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
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

  /** The ground a shape in flight is drawn on and a zone of every floor lies at. */
  const zonePlane = () => propsRef.current.zonePlaneZ ?? planeZRef.current;

  /** The zones on the floor shown: the only ones a press may touch. */
  const shownZones = () => {
    const { zones: all, zoneFloor: floor } = propsRef.current;
    return all.filter((zone) => zoneOnFloor(zone, floor));
  };

  /** The point at height `z` under a pointer position, metres, or null off the tree. */
  const castAt = (event: { clientX: number; clientY: number }, z: number): ZonePoint | null => {
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
    const hit = raycaster.ray.intersectPlane(
      new THREE.Plane(new THREE.Vector3(0, 0, 1), -z),
      new THREE.Vector3(),
    );
    // Off the tree's box is nowhere the robot can be kept out of.
    return hit && columnAt(session.voxels, hit.x, hit.y) ? { x: hit.x, y: hit.y } : null;
  };

  /** Map-frame points on screen, CSS pixels in the client frame a pointer event uses. */
  const toScreen = (points: readonly { x: number; y: number; z: number }[]) => {
    const ctx = sceneRef.current;
    const container = containerRef.current;
    if (!ctx || !container) return [];
    const rect = container.getBoundingClientRect();
    ctx.camera.updateMatrixWorld();
    return points.map(({ x, y, z }) => {
      const v = new THREE.Vector3(x, y, z).project(ctx.camera);
      return {
        cx: rect.left + ((v.x + 1) / 2) * rect.width,
        cy: rect.top + ((1 - v.y) / 2) * rect.height,
      };
    });
  };

  const cornerRadius = (event: { pointerType: string }) =>
    event.pointerType === "touch" ? CORNER_RADIUS_TOUCH_PX : CORNER_RADIUS_PX;

  /** The corner of the shape in flight under a press, or null. */
  const draftCornerAt = (event: React.PointerEvent<HTMLDivElement>): number | null => {
    const z = zonePlane();
    const screen = toScreen(propsRef.current.zoneDraft.map((p) => ({ ...p, z })));
    return cornerAt(screen, { cx: event.clientX, cy: event.clientY }, cornerRadius(event));
  };

  /**
   * The finished zone's corner under a press, with the height it lies at, or
   * null. Any shown zone's until the shape is anchored, then only its own
   * zone's, the anchor itself excepted -- the floor plan's rule.
   */
  const handleAt = (
    event: React.PointerEvent<HTMLDivElement>,
    { anchored }: { anchored: boolean },
  ): (ZoneCornerRef & { zoneId: string; z: number }) | null => {
    const anchor = propsRef.current.zoneAnchor;
    const plane = zonePlane();
    const handles = shownZones().flatMap((zone) => {
      if (anchored && anchor && zone.id !== anchor.zoneId) return [];
      const z = zoneGround(zone) ?? plane;
      return zone.points.flatMap((point, index) =>
        anchored && anchor && index === anchor.index ? [] : [{ zoneId: zone.id, index, z, point }],
      );
    });
    const screen = toScreen(handles.map(({ point, z }) => ({ ...point, z })));
    const hit = cornerAt(screen, { cx: event.clientX, cy: event.clientY }, cornerRadius(event));
    if (hit === null) return null;
    const { zoneId, index, z } = handles[hit];
    return { zoneId, index, z };
  };

  /** What a tap with a zone tool armed does: the floor plan's rules (classifyZonePress). */
  const tapZone = (event: React.PointerEvent<HTMLDivElement>) => {
    const { tool, zoneDraft: draft, zoneAnchor: anchor } = propsRef.current;
    if (tool === "zoneRemove") {
      const at = castAt(event, zonePlane());
      const zone = at && zoneAt(shownZones(), at);
      if (zone) propsRef.current.onZoneRemove(zone);
      return;
    }
    const corner = draft.length > 0 ? draftCornerAt(event) : null;
    const handle = handleAt(event, { anchored: anchor !== null });
    const verdict = classifyZonePress({
      count: draft.length,
      anchored: anchor !== null,
      corner,
      // No selection on the 3D view (Remove zone is a tool of its own), so a
      // press inside a zone is a corner like any other.
      onZone: false,
      additive: false,
      onHandle: handle !== null,
    });
    if (verdict === "close") propsRef.current.onZoneClose();
    else if (verdict === "anchor" && handle) {
      propsRef.current.onZoneAnchor({ zoneId: handle.zoneId, index: handle.index });
    } else if (verdict === "merge" && handle) propsRef.current.onZoneMerge(handle.index);
    else if (verdict === "add") {
      const at = castAt(event, zonePlane());
      if (at) propsRef.current.onZoneCorner(at);
    }
    // "select" cannot happen (onZone is false); "ignore" does nothing.
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

  /** Show the draft marker at a pose, on `z` (the place plane by default), or hide it. */
  const showDraft = (pose: PlanarPose | null, z = propsRef.current.placeZ) => {
    draftRef.current = pose;
    const ctx = sceneRef.current;
    if (!ctx) return;
    placePoseMarker(ctx.draft, pose && { ...pose, z });
    invalidate();
  };

  /** Put a grabbed stop back where it was, with nothing committed. */
  const dropDrag = () => {
    dragRef.current = null;
    showDraft(null);
    vertexLayerRef.current?.setMoving(propsRef.current.movingVertex?.id ?? null);
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
    const { radius, reach } = propsRef.current;
    const changed = erase
      ? eraseDab(session.size, session.edits, strokeRef.current, column.x, column.y, radius)
      : fillDab(
          session.stacks,
          session.edits,
          strokeRef.current,
          column.x,
          column.y,
          radius,
          aimKzRef.current,
          reach,
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

  /**
   * Move the brush ring onto the column under the pointer, at the height it
   * aims at. A fill that would find no surface to read there turns the ring
   * the caution hue and says so, rather than leaving a stroke to do nothing.
   */
  const hover = (hit: THREE.Vector3 | null, erase: boolean) => {
    const ctx = sceneRef.current;
    const { tool, radius, reach } = propsRef.current;
    const column = columnOfHit(hit);
    const lost =
      !erase &&
      column !== null &&
      patchHeight(session.stacks, session.edits, column.x, column.y, aimKzRef.current, {
        ...reach,
        ring: reach.ring + radius,
      }) === null;
    setUnreadable(lost);
    if (ctx) {
      ctx.brush.visible = tool !== "orbit" && column !== null;
      if (hit && column) {
        const r = (radius + 0.5) * session.voxels.res;
        ctx.brush.position.set(hit.x, hit.y, hit.z);
        ctx.brush.scale.set(r, r, 1);
        const signal = SIGNAL[theme];
        ctx.brush.material.color.set(erase ? signal.warn : lost ? signal.caution : signal.cmd);
      }
      invalidate();
    }
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const { tool } = propsRef.current;
    if (tapsZones(tool)) {
      // Resolved on release, so a drag never drops a corner; a second finger
      // (a pinch) abandons the press. A press on a corner may become its drag:
      // the shape's own, else a finished zone's (Zone only, not Remove).
      if (event.button !== 0 || !event.isPrimary) {
        zonePressRef.current = null;
        return;
      }
      let grab: ZoneCornerRef | null = null;
      let z = zonePlane();
      if (tool === "zone") {
        const corner = propsRef.current.zoneDraft.length > 0 ? draftCornerAt(event) : null;
        if (corner !== null) grab = { zoneId: null, index: corner };
        else {
          const handle = handleAt(event, { anchored: false });
          if (handle) {
            grab = { zoneId: handle.zoneId, index: handle.index };
            z = handle.z;
          }
        }
      }
      zonePressRef.current = {
        pointerId: event.pointerId,
        cx: event.clientX,
        cy: event.clientY,
        grab,
        z,
        dragging: false,
      };
      return;
    }
    if (tool === "move") {
      // A second finger abandons the drag, as it abandons a planted stop.
      if (dragRef.current || event.button !== 0 || !event.isPrimary) {
        if (dragRef.current) dropDrag();
        return;
      }
      const vertex = pickVertex(event);
      if (!vertex) return;
      event.preventDefault();
      const grab = castAt(event, drawnGround(vertex.z));
      dragRef.current = {
        pointerId: event.pointerId,
        vertex,
        cx: event.clientX,
        cy: event.clientY,
        dx: grab ? vertex.x - grab.x : 0,
        dy: grab ? vertex.y - grab.y : 0,
        dragging: false,
      };
      return;
    }
    if (tapsStops(tool)) {
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
    if (tapsZones(tool)) {
      const press = zonePressRef.current;
      if (!press || press.pointerId !== event.pointerId || !press.grab) return;
      if (!press.dragging && !isDrag(press.cx, press.cy, event.clientX, event.clientY)) return;
      press.dragging = true;
      const at = castAt(event, press.z);
      if (at) propsRef.current.onZoneCornerDrag(press.grab, at);
      return;
    }
    if (tool === "move") {
      const drag = dragRef.current;
      if (!drag) {
        if (event.buttons === 0) hoverVertex(pickVertex(event));
        return;
      }
      if (drag.pointerId !== event.pointerId) return;
      if (!drag.dragging) {
        if (!isDrag(drag.cx, drag.cy, event.clientX, event.clientY)) return;
        // Off the map while it is in hand, the draft marker standing in.
        drag.dragging = true;
        hoverVertex(null);
        vertexLayerRef.current?.setMoving(drag.vertex.id);
      }
      const at = castAt(event, drawnGround(drag.vertex.z));
      if (at) {
        showDraft(
          { x: at.x + drag.dx, y: at.y + drag.dy, theta: drag.vertex.theta },
          drag.vertex.z,
        );
      }
      return;
    }
    if (tapsStops(tool)) {
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
    const press = zonePressRef.current;
    if (press) {
      zonePressRef.current = null;
      if (!tapsZones(propsRef.current.tool) || press.pointerId !== event.pointerId) return;
      // A drag has already moved its corner; only a tap does anything here.
      if (!press.dragging && !isDrag(press.cx, press.cy, event.clientX, event.clientY)) {
        tapZone(event);
      }
      return;
    }
    const drag = dragRef.current;
    if (drag) {
      if (drag.pointerId !== event.pointerId) return;
      const pose = drag.dragging ? draftRef.current : null;
      dropDrag();
      // A drag lands its stop; a tap on it opens it, as with no tool armed.
      if (pose) propsRef.current.onVertexMove(drag.vertex, pose);
      else if (!drag.dragging) propsRef.current.onVertexActivate(drag.vertex);
      return;
    }
    const tap = tapRef.current;
    if (tap) {
      tapRef.current = null;
      const { tool, onVertexActivate, onVertexRemove, onVertexSelect } = propsRef.current;
      if (
        tapsStops(tool) &&
        tap.pointerId === event.pointerId &&
        !isDrag(tap.cx, tap.cy, event.clientX, event.clientY)
      ) {
        const vertex = pickVertex(event);
        if (vertex) {
          (tool === "remove" ? onVertexRemove : tool === "select" ? onVertexSelect : onVertexActivate)(
            vertex,
          );
        }
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
    // Only a deliberate release may land a dragged stop; a cancel puts it back.
    if (dragRef.current?.pointerId === event.pointerId) {
      dropDrag();
      return;
    }
    // A cancelled corner drag stays where it was let go, as a cancelled
    // stroke stays painted: it is already on screen there, and unsaved.
    if (zonePressRef.current?.pointerId === event.pointerId) zonePressRef.current = null;
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
    // A corner dragged off the canvas stays where it last was.
    zonePressRef.current = null;
    hoverVertex(null);
    // A planted or dragged stop survives the pointer leaving; a carried one does not.
    if (!anchorRef.current && !dragRef.current) showDraft(null);
    if (gestureRef.current) return;
    setUnreadable(false);
    const ctx = sceneRef.current;
    if (ctx) ctx.brush.visible = false;
    invalidate();
  };

  return (
    <>
      <div
        ref={containerRef}
        data-testid="map-3d-canvas"
        role="application"
        aria-label="The 3D map. Drag to orbit; with Fill or Erase armed, drag to paint; with Place armed, press to place and drag to aim; with Move armed, drag a waypoint to put it somewhere else; with Select armed, press waypoints to select them; with Remove armed, press a waypoint to delete it; with Zone armed, tap each corner of a forbidden zone and its first corner to close it, start on a zone's corner and end on another of its corners to merge into it, or drag a corner to move it; with Zone remove armed, tap a zone to delete it."
        className={cn(
          "absolute inset-0 touch-none",
          props.tool === "move"
            ? hovering
              ? "cursor-grab"
              : "cursor-default"
            : tapsStops(props.tool) && hovering
            ? "cursor-pointer"
            : props.tool === "orbit"
              ? "cursor-grab active:cursor-grabbing"
              : props.tool === "remove" || props.tool === "zoneRemove"
                ? "cursor-default"
                : "cursor-crosshair",
          props.className,
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onContextMenu={(event) => event.preventDefault()}
      />
      {/* Read off the tool too, so disarming Fill drops it without a render of its own. */}
      {unreadable && props.tool === "fill" && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4"
        >
          <span className="instrument-label rounded-sm bg-background/85 px-2 py-1 text-signal-caution">
            No floor near here to set a patch by
          </span>
        </div>
      )}
      {gpu.lost && <GpuLostNotice />}
    </>
  );
}
