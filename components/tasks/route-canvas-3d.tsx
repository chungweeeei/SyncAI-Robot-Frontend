"use client";

import * as React from "react";
import type * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { MaximizeIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { GpuLostNotice } from "@/components/console/fault-panel";
import { IconButton } from "@/components/tasks/icon-button";
import { useGpuContext } from "@/hooks/use-gpu-context";
import { PALETTES, VERTEX_HIT_RADIUS, VERTEX_HIT_RADIUS_TOUCH } from "@/lib/map/draw";
import { isDrag } from "@/lib/map/gesture";
import { drawRoute, drawStops, type PlacedStop } from "@/lib/map/preview";
import { frameGround } from "@/lib/scene/camera";
import { createEdlPass, type EdlPass } from "@/lib/scene/edl";
import { projectStops, stopNear } from "@/lib/scene/route-marks";
import { THEMES } from "@/lib/scene/theme";
import { createViewport } from "@/lib/scene/viewport";
import { createVoxelLayer, type VoxelLayer } from "@/lib/scene/voxel-layer";
import type { MapVertex } from "@/lib/types/map";
import type { OccupiedVoxels } from "@/lib/types/octree";
import { cn } from "@/lib/utils";

export interface RouteCanvas3dProps {
  voxels: OccupiedVoxels;
  vertices: MapVertex[];
  /**
   * The floor on show, by height `[lo, hi)` metres: its cells and its stops
   * alone are drawn and tappable, as on the dashboard. Null is every floor.
   */
  band: { lo: number; hi: number } | null;
  /** The ground the view frames, map-frame metres as drawn (see drawnGround). */
  groundZ: number;
  /** Vertex id → the job's stop numbers that go there; see stopWaypointOrdinals. */
  steps: ReadonlyMap<string, readonly number[]>;
  /** The waypoints in visiting order; see stepRoute. */
  route: readonly string[];
  onPick: (vertex: MapVertex) => void;
  /** The waypoint to ring: the stop card the editor is pointing at. */
  highlight?: string | null;
  /** The waypoint under a mouse, or null as it leaves one. */
  onHover?: (vertex: MapVertex | null) => void;
  /** The frame's height; the editor's map pane is taller than the default. */
  className?: string;
  /** Laid over the view's top-left corner: the floor picker. */
  children?: React.ReactNode;
}

/**
 * The task editor's map for a map whose picture is its 3D map: the tree in
 * 3D, and the waypoints and the route so far over it.
 *
 * The waypoints are not the 3D pins the dashboard and the editor's 3D view
 * draw: those are metre-sized, and over a whole building they are a pixel or
 * two, which cannot be found, let alone tapped. They are the floor plan
 * preview's marks instead (drawStops), projected through the camera onto a
 * 2D canvas over the view, so they keep their size, their names and their
 * step numbers at any zoom, and a tap is tested in screen pixels with the
 * floor plan's slop. The route's legs join them there too. Drawn without depth, so a floor's stops show through the
 * storey over it with All picked; a floor picked shows that floor's alone.
 *
 * A drag orbits and two fingers pinch and pan, as OrbitControls has them;
 * only a primary press lifted inside the deadzone on a waypoint picks it.
 * A second finger landing abandons the press, so a pinch begun on a stop
 * never also adds it. Draws only when something changed or the camera
 * moves, as the editor's view does.
 */
export function RouteCanvas3d({
  voxels,
  vertices,
  band,
  groundZ,
  steps,
  route,
  onPick,
  highlight = null,
  onHover,
  className,
  children,
}: RouteCanvas3dProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const marksRef = React.useRef<HTMLCanvasElement>(null);
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const gpu = useGpuContext();

  const sceneRef = React.useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    layer: VoxelLayer;
    edl: EdlPass;
  } | null>(null);
  /** Where each shown stop was last drawn, which a tap is tested against. */
  const placedRef = React.useRef<ReadonlyMap<string, PlacedStop>>(new Map());
  /** The overlay's CSS size, from the viewport's resize. */
  const sizeRef = React.useRef({ width: 0, height: 0 });
  /** A press that may still be a tap: the pointer that made it, and where. */
  const tapRef = React.useRef<{ pointerId: number; cx: number; cy: number } | null>(null);
  /** Pointers down, so a second one can be told from a first. */
  const downRef = React.useRef(new Set<number>());
  const [hovering, setHovering] = React.useState(false);

  // Read at draw time and by the scene effect without being its deps, so a
  // floor switch or a new route does not rebuild the tree.
  const latestRef = React.useRef({
    vertices,
    band,
    groundZ,
    steps,
    route,
    onPick,
    highlight,
    onHover,
    theme,
  });
  React.useLayoutEffect(() => {
    latestRef.current = { vertices, band, groundZ, steps, route, onPick, highlight, onHover, theme };
  });

  const frameDirtyRef = React.useRef(true);
  const invalidate = React.useCallback(() => {
    frameDirtyRef.current = true;
  }, []);

  /** The overlay, redrawn with every frame of the view under it. */
  const drawMarks = React.useCallback((camera: THREE.Camera) => {
    const canvas = marksRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const { width, height } = sizeRef.current;
    const {
      vertices: stops,
      band: shown,
      steps: marks,
      route: legs,
      highlight: ringed,
      theme: hue,
    } = latestRef.current;
    const placed = projectStops(camera, stops, shown, width, height);
    placedRef.current = placed;
    const dpr = canvas.width / Math.max(width, 1);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);
    const palette = PALETTES[hue];
    if (legs.length > 1) drawRoute(context, legs, placed, palette.cmd);
    drawStops(context, stops, placed, marks, palette, ringed);
  }, []);

  const fit = React.useCallback(() => {
    const ctx = sceneRef.current;
    if (ctx) frameGround(ctx.camera, ctx.controls, ctx.layer.frame, latestRef.current.groundZ);
    invalidate();
  }, [invalidate]);

  // ---- Scene (rebuilds on a new tree or theme) ---------------------------
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const viewport = createViewport(container, {
      background: THEMES[theme].background,
      near: 0.05,
    });
    const { scene, camera, renderer, controls } = viewport;
    controls.enableDamping = true;
    controls.addEventListener("change", invalidate);
    const edl = createEdlPass(voxels.res);

    const layer = createVoxelLayer(voxels);
    const { band: shown, groundZ: ground } = latestRef.current;
    layer.setBand(shown?.lo ?? -Infinity, shown?.hi ?? Infinity);
    scene.add(layer.points);
    frameGround(camera, controls, layer.frame, ground);
    sceneRef.current = { scene, camera, controls, layer, edl };
    frameDirtyRef.current = true;

    const render = () => {
      edl.render(renderer, scene, camera);
      drawMarks(camera);
    };
    viewport.start({
      draw: render,
      onResize: (width, height, pixelRatio) => {
        edl.setSize(width, height, pixelRatio);
        sizeRef.current = { width, height };
        const marks = marksRef.current;
        if (marks) {
          marks.width = Math.round(width * pixelRatio);
          marks.height = Math.round(height * pixelRatio);
        }
      },
      onContextLost: gpu.onContextLost,
      onContextRestored: gpu.onContextRestored,
      frame: () => {
        if (controls.update()) frameDirtyRef.current = true;
        if (!frameDirtyRef.current) return;
        frameDirtyRef.current = false;
        render();
      },
    });

    return () => {
      controls.removeEventListener("change", invalidate);
      layer.dispose();
      edl.dispose();
      viewport.dispose();
      sceneRef.current = null;
    };
  }, [voxels, theme, invalidate, drawMarks, gpu.onContextLost, gpu.onContextRestored]);

  // ---- The floor on show ---------------------------------------------------
  const bandLo = band?.lo ?? -Infinity;
  const bandHi = band?.hi ?? Infinity;
  React.useEffect(() => {
    const ctx = sceneRef.current;
    if (!ctx) return;
    ctx.layer.setBand(bandLo, bandHi);
    // A floor switch looks at that floor's ground, as the editor's does.
    frameGround(ctx.camera, ctx.controls, ctx.layer.frame, latestRef.current.groundZ);
    invalidate();
  }, [bandLo, bandHi, invalidate]);

  // The marks and the route are drawn from latestRef, so a new list, new
  // step numbers or a longer route only need the next frame.
  React.useEffect(() => {
    invalidate();
  }, [vertices, steps, route, highlight, invalidate]);

  /** The last waypoint reported to onHover, so a move over the same one says nothing. */
  const hoveredRef = React.useRef<string | null>(null);
  const reportHover = (vertex: MapVertex | null) => {
    const id = vertex?.id ?? null;
    if (id === hoveredRef.current) return;
    hoveredRef.current = id;
    latestRef.current.onHover?.(vertex);
  };

  /** The stop under a pointer, by the marks as last drawn, with a finger's wider slop. */
  const stopAt = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return stopNear(
      placedRef.current,
      latestRef.current.vertices,
      event.clientX - bounds.left,
      event.clientY - bounds.top,
      event.pointerType === "touch" ? VERTEX_HIT_RADIUS_TOUCH : VERTEX_HIT_RADIUS,
    );
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    downRef.current.add(event.pointerId);
    // A second finger is a pinch, never a second press, and ends the first's tap.
    if (downRef.current.size > 1) {
      tapRef.current = null;
      return;
    }
    if (event.button !== 0) return;
    tapRef.current = { pointerId: event.pointerId, cx: event.clientX, cy: event.clientY };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const tap = tapRef.current;
    if (
      tap &&
      tap.pointerId === event.pointerId &&
      isDrag(tap.cx, tap.cy, event.clientX, event.clientY)
    ) {
      // Past the deadzone it is an orbit, whatever it lifts on.
      tapRef.current = null;
    }
    // Hover only with no button down; a button down is a camera drag.
    if (event.pointerType === "mouse" && event.buttons === 0) {
      const under = stopAt(event);
      setHovering(under !== null);
      reportHover(under);
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    downRef.current.delete(event.pointerId);
    const tap = tapRef.current;
    if (!tap || tap.pointerId !== event.pointerId) return;
    tapRef.current = null;
    if (isDrag(tap.cx, tap.cy, event.clientX, event.clientY)) return;
    const vertex = stopAt(event);
    if (vertex) latestRef.current.onPick(vertex);
  };

  // Only a deliberate lift picks: a cancelled pointer never does.
  const handlePointerCancel = (event: React.PointerEvent<HTMLDivElement>) => {
    downRef.current.delete(event.pointerId);
    if (tapRef.current?.pointerId === event.pointerId) tapRef.current = null;
  };

  return (
    <div
      className={cn(
        "relative w-full overflow-hidden rounded-sm border border-hairline",
        className ?? "h-64 sm:h-80",
      )}
    >
      <div
        ref={containerRef}
        data-testid="route-canvas-3d"
        role="application"
        aria-label="The 3D map with this map's waypoints. Drag to orbit; tap a waypoint to add it as the next stop."
        // touch-none: every finger here is the map's, an orbit or a pick.
        className={cn(
          "absolute inset-0 touch-none select-none",
          hovering ? "cursor-pointer" : "cursor-grab active:cursor-grabbing",
        )}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={() => {
          setHovering(false);
          reportHover(null);
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      {/* Over the view and out of the pointer's way: presses go to the view. */}
      <canvas
        ref={marksRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 size-full"
      />
      <div
        role="toolbar"
        aria-label="3D map view"
        className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-sm border border-hairline bg-panel/85 p-0.5 backdrop-blur-sm"
      >
        <IconButton label="Fit to view" disabled={false} onClick={fit}>
          <MaximizeIcon className="size-3.5" aria-hidden />
        </IconButton>
      </div>
      {children && <div className="absolute top-1.5 left-1.5">{children}</div>}
      {gpu.lost && <GpuLostNotice />}
    </div>
  );
}
