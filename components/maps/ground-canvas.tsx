"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { drawCellGrid } from "@/lib/map/draw";
import { isDrag, wheelZoomFactor } from "@/lib/map/gesture";
import {
  PALETTES,
  drawGroundBrush,
  eraseRingColor,
  paintColumn,
  paintColumns,
} from "@/lib/map/ground-draw";
import {
  GroundStroke,
  cellOf,
  columnOf,
  eraseDab,
  fillDab,
  localFloor,
  type GroundPatch,
  type GroundSession,
} from "@/lib/map/ground-fill";
import type { Cell } from "@/lib/map/grid";
import {
  CELL_GRID_MIN_SCALE,
  cellAt,
  fitView,
  panBy,
  reanchorView,
  screenToGrid,
  zoomAt,
  type View,
} from "@/lib/map/view";
import { cn } from "@/lib/utils";

export type GroundTool = "pan" | "fill" | "erase";

/** The cell under the pointer and the floor a fill there would get. */
export interface GroundHover {
  col: number;
  row: number;
  /** Relative kz the brush would fill at, or null with no floor nearby to read. */
  floor: number | null;
}

type Gesture =
  | { kind: "paint"; pointerId: number; last: Cell; erase: boolean }
  | { kind: "pan"; pointerId: number; cx: number; cy: number };

export interface GroundCanvasProps {
  session: GroundSession;
  tool: GroundTool;
  /** Brush radius in cells. */
  radius: number;
  /** How far past the brush the floor median reads, cells. */
  ring: number;
  /** The clearance band a hole must be empty through, cells. */
  clearance: number;
  spacePan: boolean;
  fitNonce: number;
  zoomStep: { factor: number } | null;
  /** Bumped when every column must be repainted: an undo, a band change. */
  rasterNonce: number;
  onStrokeCommit: (patch: GroundPatch) => void;
  onHover: (hover: GroundHover | null) => void;
  /** The view's scale, published once per frame on change, for the zoom readout. */
  onScaleChange: (scale: number) => void;
  className?: string;
}

/**
 * The ground editor's canvas: the 3D map's columns from above, one cell a
 * column, coloured by floor height, with the operator's patches over them.
 * The floor plan editor's canvas with the parts the brush needs and no
 * more: one view transform in a ref (lib/map/view.ts), one gesture at a
 * time, a pinch for a second finger, and a stroke that dabs the fill rule
 * (lib/map/ground-fill.ts) along the pointer's path.
 */
export const GroundCanvas = React.memo(function GroundCanvas(props: GroundCanvasProps) {
  const { session, className } = props;
  const { resolvedTheme } = useTheme();
  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";

  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const viewRef = React.useRef<View | null>(null);
  const rectRef = React.useRef<{ width: number; height: number } | null>(null);
  const gestureRef = React.useRef<Gesture | null>(null);
  const strokeRef = React.useRef(new GroundStroke());
  const touchesRef = React.useRef(new Map<number, { cx: number; cy: number }>());
  const pinchRef = React.useRef<{
    a: number;
    b: number;
    dist: number;
    cx: number;
    cy: number;
  } | null>(null);
  const hoverRef = React.useRef<GroundHover | null>(null);
  const publishedHoverRef = React.useRef("");
  const publishedScaleRef = React.useRef(0);
  const rafRef = React.useRef(0);
  const drawRef = React.useRef<(() => void) | null>(null);
  /**
   * The raster: a detached canvas one pixel a column, and the ImageData it
   * was painted from, kept so a dab repaints its cells rather than the map.
   */
  const rasterRef = React.useRef<{
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    image: ImageData;
  } | null>(null);

  const propsRef = React.useRef(props);
  React.useEffect(() => {
    propsRef.current = props;
  });
  const themeRef = React.useRef(theme);
  themeRef.current = theme;

  const requestDraw = React.useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      drawRef.current?.();
    });
  }, []);

  const draw = React.useCallback(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const raster = rasterRef.current;
    if (!container || !canvas || !raster) return;

    const bounds = container.getBoundingClientRect();
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
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = PALETTES[themeRef.current];
    ctx.fillStyle = palette.well;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!viewRef.current) viewRef.current = fitView(rect, session.size);
    const view = viewRef.current;
    const w = session.size.width * view.scale;
    const h = session.size.height * view.scale;

    // Nearest at or above 1:1 so a cell edge is a cell edge; filtered below.
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(raster.canvas, view.ox, view.oy, w, h);

    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.extent;
    ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, w + 1, h + 1);
    if (view.scale >= CELL_GRID_MIN_SCALE) drawCellGrid(ctx, view, rect, session.size, palette);

    const current = propsRef.current;
    const hover = hoverRef.current;
    const gesture = gestureRef.current;
    const brushing = current.tool !== "pan" && !current.spacePan && gesture?.kind !== "pan";
    if (hover && brushing) {
      const erasing = gesture?.kind === "paint" ? gesture.erase : current.tool === "erase";
      drawGroundBrush(
        ctx,
        view,
        hover,
        current.radius,
        erasing ? eraseRingColor(themeRef.current) : palette.cmd,
      );
    }

    // Published at most once per frame, and only on a real change.
    const hoverKey = hover ? `${hover.col},${hover.row},${hover.floor}` : "";
    if (publishedHoverRef.current !== hoverKey) {
      publishedHoverRef.current = hoverKey;
      current.onHover(hover);
    }
    const scalePercent = Math.round(view.scale * 100);
    if (publishedScaleRef.current !== scalePercent) {
      publishedScaleRef.current = scalePercent;
      current.onScaleChange(view.scale);
    }
  }, [session]);
  drawRef.current = draw;

  /** Build or repaint the raster whole; the dab path repaints cells. */
  const paintAll = React.useCallback(() => {
    const { width, height } = session.size;
    let raster = rasterRef.current;
    if (!raster || raster.canvas.width !== width || raster.canvas.height !== height) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      raster = { canvas, ctx, image: ctx.createImageData(width, height) };
      rasterRef.current = raster;
    }
    paintColumns(raster.image, session.floors, session.edits, session.band, themeRef.current);
    raster.ctx.putImageData(raster.image, 0, 0);
    requestDraw();
  }, [session, requestDraw]);

  React.useEffect(() => {
    paintAll();
  }, [paintAll, props.rasterNonce, theme]);

  React.useEffect(() => {
    viewRef.current = null;
    requestDraw();
  }, [props.fitNonce, requestDraw]);

  const zoomStep = props.zoomStep;
  React.useEffect(() => {
    if (!zoomStep) return;
    const view = viewRef.current;
    const rect = rectRef.current;
    if (!view || !rect) return;
    viewRef.current = zoomAt(view, rect.width / 2, rect.height / 2, zoomStep.factor, rect, session.size);
    requestDraw();
  }, [zoomStep, session, requestDraw]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let previous = rectRef.current;
    const observer = new ResizeObserver(() => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;
      const next = { width: bounds.width, height: bounds.height };
      if (viewRef.current && previous) {
        viewRef.current = reanchorView(viewRef.current, previous, next, session.size);
      }
      previous = next;
      rectRef.current = next;
      requestDraw();
    });
    observer.observe(container);

    // Non-passive, or a trackpad pinch page-zooms the console (see grid-canvas).
    const onWheel = (event: WheelEvent) => {
      const rect = rectRef.current;
      const view = viewRef.current;
      if (!rect || !view) return;
      event.preventDefault();
      const bounds = container.getBoundingClientRect();
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode, rect.height);
      viewRef.current = zoomAt(
        view,
        event.clientX - bounds.left,
        event.clientY - bounds.top,
        factor,
        rect,
        session.size,
      );
      requestDraw();
    };
    container.addEventListener("wheel", onWheel, { passive: false });
    requestDraw();
    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", onWheel);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [session, requestDraw]);

  const localPoint = (event: React.PointerEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    rectRef.current = { width: bounds.width, height: bounds.height };
    return { cx: event.clientX - bounds.left, cy: event.clientY - bounds.top };
  };

  /** The cell under a point, clamped so a drag past the edge keeps painting the edge. */
  const clampedCell = (view: View, cx: number, cy: number): Cell => {
    const { px, py } = screenToGrid(view, cx, cy);
    return {
      col: Math.min(Math.max(Math.floor(px), 0), session.size.width - 1),
      row: Math.min(Math.max(Math.floor(py), 0), session.size.height - 1),
    };
  };

  /** Repaint the columns a dab changed, as one rectangle of the raster. */
  const repaint = (changed: number[]) => {
    const raster = rasterRef.current;
    if (!raster || changed.length === 0) return;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const index of changed) {
      paintColumn(
        raster.image,
        session.floors,
        session.edits,
        session.band,
        themeRef.current,
        index,
      );
      const { col, row } = cellOf(session.size, index);
      if (col < x0) x0 = col;
      if (col > x1) x1 = col;
      if (row < y0) y0 = row;
      if (row > y1) y1 = row;
    }
    raster.ctx.putImageData(raster.image, 0, 0, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
  };

  const dab = (cell: Cell, erase: boolean) => {
    const { radius, ring, clearance } = propsRef.current;
    const ky = session.size.height - 1 - cell.row;
    const changed = erase
      ? eraseDab(session.floors, session.edits, strokeRef.current, cell.col, ky, radius)
      : fillDab(
          session.floors,
          session.edits,
          strokeRef.current,
          cell.col,
          ky,
          radius,
          ring,
          clearance,
        );
    repaint(changed);
  };

  /** Every cell on the line between two samples, so a flick leaves no gap. */
  const dabLine = (from: Cell, to: Cell, erase: boolean) => {
    let { col, row } = from;
    const dCol = Math.abs(to.col - col);
    const dRow = Math.abs(to.row - row);
    const stepCol = col < to.col ? 1 : -1;
    const stepRow = row < to.row ? 1 : -1;
    let error = dCol - dRow;
    for (;;) {
      dab({ col, row }, erase);
      if (col === to.col && row === to.row) return;
      const e2 = 2 * error;
      if (e2 > -dRow) {
        error -= dRow;
        col += stepCol;
      }
      if (e2 < dCol) {
        error += dCol;
        row += stepRow;
      }
    }
  };

  const probe = (view: View, cx: number, cy: number): GroundHover | null => {
    const cell = cellAt(view, session.size, cx, cy);
    if (!cell) return null;
    const { radius, ring } = propsRef.current;
    const ky = session.size.height - 1 - cell.row;
    return {
      ...cell,
      floor: localFloor(session.floors, session.edits, cell.col, ky, radius + ring),
    };
  };

  const setCursor = (cursor: "grabbing" | null) => {
    const container = containerRef.current;
    if (container) container.style.cursor = cursor ?? "";
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view) return;
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;
    const { tool, spacePan } = propsRef.current;
    const { cx, cy } = localPoint(event);

    if (event.pointerType === "touch") {
      touchesRef.current.set(event.pointerId, { cx, cy });
      // A second finger pinches if the first is panning or idle; over a
      // stroke it is ignored, since a zoom would move the map under the cells
      // being painted.
      const gesture = gestureRef.current;
      if (touchesRef.current.size === 2 && !pinchRef.current && (!gesture || gesture.kind === "pan")) {
        if (gesture) {
          gestureRef.current = null;
          setCursor(null);
        }
        const [a, b] = [...touchesRef.current.entries()];
        pinchRef.current = {
          a: a[0],
          b: b[0],
          dist: Math.hypot(b[1].cx - a[1].cx, b[1].cy - a[1].cy),
          cx: (a[1].cx + b[1].cx) / 2,
          cy: (a[1].cy + b[1].cy) / 2,
        };
        event.preventDefault();
        event.currentTarget.setPointerCapture(a[0]);
        event.currentTarget.setPointerCapture(b[0]);
        return;
      }
    }
    if (gestureRef.current || pinchRef.current) return;

    const pans = event.button !== 0 || spacePan || tool === "pan";
    if (!pans) {
      const cell = cellAt(view, session.size, cx, cy);
      if (!cell) return;
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      // Shift erases with Fill armed, the viewer's habit; a finger has no Shift.
      const erase = tool === "erase" || event.shiftKey;
      gestureRef.current = { kind: "paint", pointerId: event.pointerId, last: cell, erase };
      dab(cell, erase);
      hoverRef.current = probe(view, cx, cy);
      requestDraw();
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = { kind: "pan", pointerId: event.pointerId, cx, cy };
    setCursor("grabbing");
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view) return;
    const rect = rectRef.current;
    const { cx, cy } = localPoint(event);
    const gesture = gestureRef.current;

    if (event.pointerType === "touch" && touchesRef.current.has(event.pointerId)) {
      touchesRef.current.set(event.pointerId, { cx, cy });
    }
    const pinch = pinchRef.current;
    if (pinch) {
      if (event.pointerId !== pinch.a && event.pointerId !== pinch.b) return;
      const a = touchesRef.current.get(pinch.a);
      const b = touchesRef.current.get(pinch.b);
      if (!a || !b || !rect) return;
      const dist = Math.hypot(b.cx - a.cx, b.cy - a.cy);
      const mx = (a.cx + b.cx) / 2;
      const my = (a.cy + b.cy) / 2;
      let next = view;
      if (pinch.dist > 0 && dist > 0) {
        next = zoomAt(next, pinch.cx, pinch.cy, dist / pinch.dist, rect, session.size);
      }
      viewRef.current = panBy(next, mx - pinch.cx, my - pinch.cy, rect, session.size);
      pinch.dist = dist;
      pinch.cx = mx;
      pinch.cy = my;
      requestDraw();
      return;
    }
    if (gesture && gesture.pointerId !== event.pointerId) return;

    hoverRef.current = probe(view, cx, cy);

    if (!gesture) {
      requestDraw();
      return;
    }
    if (gesture.kind === "pan") {
      if (!rect) return;
      viewRef.current = panBy(view, cx - gesture.cx, cy - gesture.cy, rect, session.size);
      gesture.cx = cx;
      gesture.cy = cy;
      requestDraw();
      return;
    }

    // The samples merged into this event, or a fast flick loses its curve.
    const points =
      typeof event.nativeEvent.getCoalescedEvents === "function"
        ? event.nativeEvent.getCoalescedEvents()
        : [];
    const bounds = event.currentTarget.getBoundingClientRect();
    const samples = points.length
      ? points.map((p) => ({ cx: p.clientX - bounds.left, cy: p.clientY - bounds.top }))
      : [{ cx, cy }];
    for (const sample of samples) {
      const cell = clampedCell(view, sample.cx, sample.cy);
      if (cell.col === gesture.last.col && cell.row === gesture.last.row) continue;
      dabLine(gesture.last, cell, gesture.erase);
      gesture.last = cell;
    }
    requestDraw();
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") touchesRef.current.delete(event.pointerId);
    const pinch = pinchRef.current;
    if (pinch && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
      pinchRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(gesture.pointerId)) {
      event.currentTarget.releasePointerCapture(gesture.pointerId);
    }
    if (gesture.kind === "pan") {
      setCursor(null);
      return;
    }
    // A cancelled pointer commits too: the edits are already made, and an
    // edit undo cannot reach is worse than a short stroke.
    const patch = strokeRef.current.commit(session.edits);
    if (patch) propsRef.current.onStrokeCommit(patch);
    requestDraw();
  };

  const panCursor = props.tool === "pan" || props.spacePan ? "cursor-grab active:cursor-grabbing" : "";

  return (
    <div
      ref={containerRef}
      data-testid="ground-canvas"
      className={cn(
        "relative h-full w-full touch-none overflow-hidden select-none",
        panCursor || "cursor-crosshair",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={endGesture}
      onContextMenu={(event) => event.preventDefault()}
      onPointerLeave={() => {
        if (gestureRef.current) return;
        hoverRef.current = null;
        requestDraw();
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
});

/** Exported for the shell's readout: a raster cell to its column index. */
export { columnOf, isDrag };
