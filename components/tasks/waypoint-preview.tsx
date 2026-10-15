"use client";

import * as React from "react";
import { MaximizeIcon, ZoomInIcon, ZoomOutIcon } from "lucide-react";
import { useTheme } from "next-themes";

import { IconButton } from "@/components/tasks/icon-button";
import { useMapImage } from "@/hooks/use-map-image";
import { PALETTES } from "@/lib/map/draw";
import { ZOOM_STEP_FACTOR, wheelZoomFactor } from "@/lib/map/gesture";
import { drawWaypointPreview, previewView } from "@/lib/map/preview";
import { panBy, reanchorView, zoomAt, type View } from "@/lib/map/view";
import type { MapVertex } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

export interface WaypointPreviewProps {
  mapName: string;
  meta: MapMetadata;
  vertices: MapVertex[];
  /** Vertex id → the job's step numbers that go there; see stepWaypointOrdinals. */
  steps: ReadonlyMap<string, readonly number[]>;
  /** The waypoints a dock row is picked on; see stepDockVertices. */
  docks: ReadonlySet<string>;
}

/** The one pointer dragging the map, in container-local px at its last move. */
interface Pan {
  pointerId: number;
  cx: number;
  cy: number;
}

/**
 * The floor plan a Move row opens under its waypoint picker, because a name in
 * a dropdown is not a place. Every stop is drawn with its name, and the job's
 * Move stops are lit with their step numbers, so the map reads as the route.
 * Mounted only while open, so the raster is fetched only when asked for.
 *
 * A view, not a control: it shows the whole job, so a click on a stop would
 * mean no one row. The dropdown sets a step (also the keyboard and
 * screen-reader path), hence `role="img"` with a description.
 *
 * It zooms and pans, since two nearby stops are pixels apart at fit scale,
 * with the floor plan editor's view machinery so both feel the same. Draws on
 * change with one rAF, no persistent loop, as the editor does.
 */
export function WaypointPreview({
  mapName,
  meta,
  vertices,
  steps,
  docks,
}: WaypointPreviewProps) {
  const { image } = useMapImage(mapName);
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const rafRef = React.useRef(0);
  /**
   * Null until the first paint builds the fit, and reset by Fit. A ref, not
   * state: every pointer move writes it, and a render per move is wasted.
   */
  const viewRef = React.useRef<View | null>(null);
  /** Cached container size, so a pointer move is not a forced layout read. */
  const rectRef = React.useRef<{ width: number; height: number } | null>(null);
  const panRef = React.useRef<Pan | null>(null);
  /**
   * Fingers down by pointer id, and the pinch two of them make. Apart from the
   * pan, so a finger left after a pinch does not become a pan and jump the map.
   */
  const touchesRef = React.useRef(new Map<number, { cx: number; cy: number }>());
  const pinchRef = React.useRef<{
    a: number;
    b: number;
    dist: number;
    cx: number;
    cy: number;
  } | null>(null);

  /**
   * The zoom in whole percent, for the `data-zoom` the e2e suite reads, since
   * nothing on screen prints the scale. Only a changed value renders, so a pan
   * costs none.
   */
  const [zoomPercent, setZoomPercent] = React.useState(0);

  // Read at draw time so `draw` stays stable and a prop change does not
  // rebuild the listener effect below.
  const frameRef = React.useRef({ image, meta, vertices, steps, docks, theme });

  const draw = React.useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;
    const bounds = container.getBoundingClientRect();
    // A zero rect gives fitView scale 0; skip the frame rather than draw NaN.
    if (bounds.width < 1 || bounds.height < 1) return;
    const rect = { width: bounds.width, height: bounds.height };
    rectRef.current = rect;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(rect.width * dpr);
    const bh = Math.round(rect.height * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // DPR here and nowhere else, so the view stays in the CSS pixels the
    // pointer events report.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const frame = frameRef.current;
    if (!viewRef.current) viewRef.current = previewView(rect, frame.meta);
    const view = viewRef.current;
    drawWaypointPreview(
      ctx,
      rect,
      view,
      frame.image,
      frame.meta,
      frame.vertices,
      { steps: frame.steps, docks: frame.docks },
      PALETTES[frame.theme],
    );
    setZoomPercent(Math.round(view.scale * 100));
  }, []);

  const requestDraw = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      draw();
    });
  }, [draw]);

  React.useEffect(() => {
    frameRef.current = { image, meta, vertices, steps, docks, theme };
    requestDraw();
  }, [requestDraw, image, meta, vertices, steps, docks, theme]);

  // A different map refits.
  React.useEffect(() => {
    viewRef.current = null;
    requestDraw();
  }, [meta, requestDraw]);

  /**
   * The grid size, and the fit scale that is also the zoom-out floor. Read
   * through frameRef so the listener effect need not list `meta`: re-running
   * it would drop a pinch in flight.
   */
  const gridSize = React.useCallback(() => {
    const { width, height } = frameRef.current.meta;
    return { width, height };
  }, []);
  const floorScale = React.useCallback(
    (rect: { width: number; height: number }) => previewView(rect, frameRef.current.meta).scale,
    [],
  );

  const zoomBy = (factor: number, cx: number, cy: number) => {
    const rect = rectRef.current;
    const view = viewRef.current;
    if (!rect || !view) return;
    viewRef.current = zoomAt(view, cx, cy, factor, rect, gridSize(), floorScale(rect));
    requestDraw();
  };

  /** About the centre: a button has no pointer to zoom about. */
  const zoomStep = (factor: number) => {
    const rect = rectRef.current;
    if (!rect) return;
    zoomBy(factor, rect.width / 2, rect.height / 2);
  };

  const fit = () => {
    viewRef.current = null;
    requestDraw();
  };

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let previous = rectRef.current;
    const observer = new ResizeObserver(() => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;
      const next = { width: bounds.width, height: bounds.height };
      // Hold the zoom across a resize rather than refitting; Fit is the way back.
      if (viewRef.current && previous) {
        viewRef.current = reanchorView(
          viewRef.current,
          previous,
          next,
          gridSize(),
          floorScale(next),
        );
      }
      previous = next;
      rectRef.current = next;
      requestDraw();
    });
    observer.observe(container);

    // Not a JSX onWheel: React attaches wheel passively, so preventDefault()
    // is ignored and a trackpad pinch (wheel + ctrlKey) page-zooms the console.
    const onWheel = (event: WheelEvent) => {
      const rect = rectRef.current;
      const view = viewRef.current;
      if (!rect || !view) return;
      event.preventDefault();
      const bounds = container.getBoundingClientRect();
      viewRef.current = zoomAt(
        view,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        wheelZoomFactor(event.deltaY, event.deltaMode, rect.height),
        rect,
        gridSize(),
        floorScale(rect),
      );
      requestDraw();
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", onWheel);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    };
  }, [requestDraw, floorScale, gridSize]);

  /** Container-local CSS pixels. */
  const localPoint = (event: React.PointerEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    rectRef.current = { width: bounds.width, height: bounds.height };
    return { cx: event.clientX - bounds.left, cy: event.clientY - bounds.top };
  };

  // Written to the element, not state, so a re-render mid-drag cannot drop it.
  const setGrabbing = (grabbing: boolean) => {
    const container = containerRef.current;
    if (container) container.style.cursor = grabbing ? "grabbing" : "";
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!viewRef.current) return;
    // Any button pans, as a right-drag does in the editor.
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const { cx, cy } = localPoint(event);

    if (event.pointerType === "touch") {
      touchesRef.current.set(event.pointerId, { cx, cy });
      // A second finger is a pinch, and ends the first finger's pan.
      if (touchesRef.current.size === 2 && !pinchRef.current) {
        panRef.current = null;
        setGrabbing(false);
        const [a, b] = [...touchesRef.current.entries()];
        pinchRef.current = {
          a: a[0],
          b: b[0],
          dist: Math.hypot(b[1].cx - a[1].cx, b[1].cy - a[1].cy),
          cx: (a[1].cx + b[1].cx) / 2,
          cy: (a[1].cy + b[1].cy) / 2,
        };
        event.preventDefault();
        // Capture both, so neither lift is lost to another element.
        event.currentTarget.setPointerCapture(a[0]);
        event.currentTarget.setPointerCapture(b[0]);
        return;
      }
    }
    // One gesture at a time; a pinch in flight owns both fingers.
    if (panRef.current || pinchRef.current) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = { pointerId: event.pointerId, cx, cy };
    setGrabbing(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    const rect = rectRef.current;
    if (!view || !rect) return;
    const { cx, cy } = localPoint(event);

    if (event.pointerType === "touch" && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { cx, cy });
    }
    const pinch = pinchRef.current;
    if (pinch) {
      if (event.pointerId !== pinch.a && event.pointerId !== pinch.b) return;
      const a = touchesRef.current.get(pinch.a);
      const b = touchesRef.current.get(pinch.b);
      if (!a || !b) return;
      const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      // Zoom about the old midpoint, then carry it to the new one, so the map
      // stays pinned under the fingers.
      let next = view;
      if (pinch.dist > 0 && dist > 0) {
        next = zoomAt(
          next,
          pinch.cx,
          pinch.cy,
          dist / pinch.dist,
          rect,
          gridSize(),
          floorScale(rect),
        );
      }
      viewRef.current = panBy(next, mx - pinch.cx, my - pinch.cy, rect, gridSize());
      pinch.dist = dist;
      pinch.cx = mx;
      pinch.cy = my;
      requestDraw();
      return;
    }

    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    viewRef.current = panBy(view, cx - pan.cx, cy - pan.cy, rect, gridSize());
    pan.cx = cx;
    pan.cy = cy;
    requestDraw();
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") touchesRef.current.delete(event.pointerId);
    const pinch = pinchRef.current;
    if (pinch && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
      // Either lift ends the pinch; the finger still down starts nothing.
      pinchRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    const pan = panRef.current;
    if (!pan || pan.pointerId !== event.pointerId) return;
    panRef.current = null;
    setGrabbing(false);
    if (event.currentTarget.hasPointerCapture(pan.pointerId)) {
      event.currentTarget.releasePointerCapture(pan.pointerId);
    }
  };

  const visited = vertices
    .map((vertex) => ({ vertex, ordinals: steps.get(vertex.id) ?? [] }))
    .filter((entry) => entry.ordinals.length > 0)
    .sort((a, b) => a.ordinals[0] - b.ordinals[0]);
  const description = `Floor plan of ${mapName} with ${vertices.length} ${
    vertices.length === 1 ? "waypoint" : "waypoints"
  }${
    visited.length
      ? `; ${visited
          .map(({ vertex, ordinals }) =>
            ordinals.length === 1
              ? `${vertex.name} is step ${ordinals[0]}`
              : `${vertex.name} is steps ${ordinals.slice(0, -1).join(", ")} and ${ordinals[ordinals.length - 1]}`,
          )
          .join(", ")}`
      : ""
  }.`;

  return (
    <div
      ref={containerRef}
      data-zoom={zoomPercent}
      // touch-none so a finger pans the map rather than the page (and fires no
      // pointercancel); select-none so a drag out does not select the list.
      className="relative h-64 w-full cursor-grab touch-none overflow-hidden rounded-sm border border-hairline select-none sm:h-80"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onContextMenu={(event) => event.preventDefault()}
      onDoubleClick={fit}
    >
      {/* Absolute so its bitmap size never changes layout and loops the ResizeObserver. */}
      <canvas ref={canvasRef} role="img" aria-label={description} className="absolute inset-0 size-full" />
      {/* For a phone (no wheel) and a keyboard (neither). Presses stop here,
        * or Zoom in would also start a pan underneath. */}
      <div
        role="toolbar"
        aria-label="Floor plan view"
        className="absolute top-1.5 right-1.5 flex items-center gap-0.5 rounded-sm border border-hairline bg-panel/85 p-0.5 backdrop-blur-sm"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <IconButton label="Zoom out" disabled={false} onClick={() => zoomStep(1 / ZOOM_STEP_FACTOR)}>
          <ZoomOutIcon className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton label="Zoom in" disabled={false} onClick={() => zoomStep(ZOOM_STEP_FACTOR)}>
          <ZoomInIcon className="size-3.5" aria-hidden />
        </IconButton>
        <IconButton label="Fit to view" disabled={false} onClick={fit}>
          <MaximizeIcon className="size-3.5" aria-hidden />
        </IconButton>
      </div>
    </div>
  );
}
