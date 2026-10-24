"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { cn } from "@/lib/utils";
import {
  stampDisc,
  stampLine,
  stampRect,
  type Cell,
  type GridValue,
} from "@/lib/map/grid";
import {
  PALETTES,
  VERTEX_HIT_RADIUS,
  VERTEX_HIT_RADIUS_TOUCH,
  drawBrushRing,
  drawCellGrid,
  drawMarquee,
  drawPreview,
  drawRobot,
  drawVertices,
  drawZoneDraft,
  drawZones,
  vertexAt,
  vertexScreen,
} from "@/lib/map/draw";
import type {
  CellProbe,
  EditMode,
  EditTool,
  Gesture,
  VertexGesture,
  VertexTool,
  ZoneTool,
} from "@/lib/map/editor";
import {
  bandBetween,
  bandIsClick,
  classifyPress,
  headingDegrees,
  idsInBand,
  isDrag,
  panPicks,
  wheelZoomFactor,
} from "@/lib/map/gesture";
import { blitGrid, blitGridRect } from "@/lib/map/render";
import type { GridPatch } from "@/lib/map/patch";
import type { GridSession } from "@/lib/map/session";
import {
  classifyZonePress,
  cornerAt,
  zoneAt,
  type ZoneAnchor,
  type ZoneCornerRef,
  type ZonePoint,
  type ZonePolygon,
} from "@/lib/map/zone";
import {
  CELL_GRID_MIN_SCALE,
  cellAt,
  centerView,
  fitView,
  gridToWorld,
  panBy,
  reanchorView,
  screenToGrid,
  worldToGrid,
  zoomAt,
  type View,
} from "@/lib/map/view";
import type { MapVertex } from "@/lib/types/map";
import type { PlanarPose } from "@/lib/types/robot";

export interface GridCanvasProps {
  session: GridSession;
  /**
   * Grid paints cells; vertex places poses; zone collects a forbidden zone's
   * corners. Only grid touches the buffer.
   */
  mode: EditMode;
  tool: EditTool;
  /** Read only in vertex mode, the way `tool` is read only in grid mode. */
  vertexTool: VertexTool;
  /** Read only in zone mode, likewise. */
  zoneTool: ZoneTool;
  value: GridValue;
  /** Odd cell diameter from BRUSH_SIZES. */
  brush: number;
  /** True while the shell sees Space held — pans without changing the tool. */
  spacePan: boolean;
  /**
   * Bumped by the shell's Fit. A nonce rather than a setter, so the view has
   * one owner.
   */
  fitNonce: number;
  /**
   * One zoom step about the centre, for the toolbar's ± (a phone has no
   * wheel). A fresh object means "now", as with `focus`.
   */
  zoomStep: { factor: number } | null;
  /**
   * A map-frame point to centre, holding the zoom; a fresh object means "now",
   * null means nothing asked. For the robot-position capture, whose draft can
   * appear off screen with no gesture to bring it there.
   */
  focus: { x: number; y: number } | null;
  /** Once per completed stroke, after the grid and mirror are updated; the shell records the patch. */
  onStrokeCommit: (patch: GridPatch) => void;
  /** Coalesced to at most one call per frame, and only when the cell changes. */
  onHover: (probe: CellProbe | null) => void;
  /** Coalesced the same way. */
  onScaleChange: (scale: number) => void;

  /** Vertices already stored for this map. Drawn in every mode. */
  vertices: MapVertex[];
  /**
   * Where the robot stands on this map, or null when unknowable (see
   * useRobotMapPose). Drawn in every mode for orientation; never interactive.
   */
  robotPose: PlanarPose | null;
  /** Staged, not-yet-created vertex. Drawn in the commanded hue. */
  draft: PlanarPose | null;
  /**
   * Highlighted: one is the vertex being edited, more is a band selection.
   * A list, not a Set, so React.memo sees a stable prop; a Set is built here
   * for the per-frame membership test.
   */
  selectedIds: readonly string[];
  /** Fired on pointer-down, before any drag, so selection feels immediate. */
  onVertexPick: (id: string | null) => void;
  /** Shift-click on a marker: add it to, or drop it from, the selection. */
  onVertexToggle: (id: string) => void;
  /** A finished rubber band's enclosed ids — possibly none, which clears unless `additive`. */
  onMarquee: (ids: string[], additive: boolean) => void;
  /** Fired once on pointer-up with the finished pose. */
  onVertexGesture: (gesture: VertexGesture) => void;

  /** Forbidden zones so far, drawn in every mode: a stop inside one is worth noticing. */
  zones: readonly ZonePolygon[];
  /**
   * The shape in flight's corners, as shell state (they arrive per click and
   * Done needs the count). The rubber line still follows the pointer via
   * hoverRef, outside React.
   */
  zoneDraft: readonly ZonePoint[];
  /** The finished zone's corner the shape in flight is attached to, if any. */
  zoneDraftAnchor: ZoneAnchor | null;
  /** A click with Shape armed, on bare map: one more corner. */
  onZonePoint: (point: ZonePoint) => void;
  /** A click on a finished zone's corner while unattached: attach there, as first or next corner. */
  onZoneAnchor: (corner: ZoneCornerRef) => void;
  /** A click on another corner of the anchored zone: replace that edge with the shape (mergeIntoZone). */
  onZoneMerge: (corner: ZoneCornerRef) => void;
  /** A click on the first corner once there are three: close the shape. */
  onZoneClose: () => void;
  /**
   * On release of a drag from a corner (the draft's or the selected zone's
   * handle): it now sits at `point`. Once per gesture; the corner follows the
   * pointer through the gesture ref meanwhile.
   */
  onZoneCornerMove: (corner: ZoneCornerRef, point: ZonePoint) => void;
  /** Highlighted, and what Remove takes. Drawn heavier than the rest. */
  selectedZoneIds: readonly string[];
  /**
   * A click (on release) inside a finished zone with no shape in flight.
   * `additive` with Shift or a finger: toggle rather than replace.
   */
  onZonePick: (id: string, additive: boolean) => void;

  className?: string;
}

/**
 * The editable grid: the only editor component touching pixels or pointer
 * events. One mutable view transform, `viewRef.current`, read by draw() and
 * every handler alike; handlers write it and request a frame, and it never
 * enters React state — a pan at pointer rate must not re-render the toolbar.
 */
export const GridCanvas = React.memo(function GridCanvas(props: GridCanvasProps) {
  const { session, className } = props;
  const { resolvedTheme } = useTheme();

  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const viewRef = React.useRef<View | null>(null);
  /**
   * Cached container size: getBoundingClientRect() in pointermove forces
   * layout, which with the hover readout's DOM write is thrash per move.
   */
  const rectRef = React.useRef<{ width: number; height: number } | null>(null);
  const gestureRef = React.useRef<Gesture | null>(null);
  /**
   * Every finger on the canvas, by pointer id, container-local. Gestures are
   * one-pointer, so this is the only record of a second finger — a pinch's.
   */
  const touchesRef = React.useRef(new Map<number, { cx: number; cy: number }>());
  /**
   * The pinch in flight, kept apart from gestureRef: it moves the view under
   * whatever tool is armed and must never stamp, band or aim.
   */
  const pinchRef = React.useRef<{
    a: number;
    b: number;
    /** Distance between the fingers and their midpoint, at the last move. */
    dist: number;
    cx: number;
    cy: number;
  } | null>(null);
  const hoverRef = React.useRef<CellProbe | null>(null);
  /**
   * The corner under the pointer with Shape armed and nothing in flight. A
   * ref like hoverRef: pointer rate, read only by draw and the cursor.
   */
  const hoverCornerRef = React.useRef<ZoneCornerRef | null>(null);
  const rafRef = React.useRef(0);
  const drawRef = React.useRef<(() => void) | null>(null);
  const publishedHoverRef = React.useRef<string>("");
  const publishedScaleRef = React.useRef(0);

  /**
   * The draw/listener effect owns a ResizeObserver and a non-passive wheel
   * listener; re-subscribing mid-drag on a callback, tool or brush change would
   * drop pointer capture and the stroke. It reads current props through here.
   */
  const propsRef = React.useRef(props);
  React.useEffect(() => {
    propsRef.current = props;
  });

  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const themeRef = React.useRef(theme);
  themeRef.current = theme;

  /**
   * Draw-on-change, coalesced to one paint per frame. Not a persistent rAF
   * loop (nothing animates, and this may run on the robot's Jetson); not a
   * bare draw() per event (a trackpad pinch sends a dozen wheels a frame).
   */
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
    if (!container || !canvas) return;

    const bounds = container.getBoundingClientRect();
    // A flex child's first layout can be 0x0, and fitView on it gives scale 0
    // — a NaN transform that never recovers.
    if (bounds.width < 1 || bounds.height < 1) return;
    const rect = { width: bounds.width, height: bounds.height };
    rectRef.current = rect;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(rect.width * dpr);
    const bh = Math.round(rect.height * dpr);
    // Only on change: assigning width/height clears and reallocates.
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // DPR only here; the view stays in CSS pixels like clientX, so hit-tests
    // need no DPR term.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = PALETTES[themeRef.current];
    ctx.fillStyle = palette.well;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!viewRef.current) viewRef.current = fitView(rect, session.grid);
    const view = viewRef.current;
    const { grid, mirror } = session;
    const w = grid.width * view.scale;
    const h = grid.height * view.scale;

    // Nearest-neighbour at or above 1:1, so a cell edge never lies about which
    // cell a click hits. Below 1:1, filtered: at fit (~0.47 on 1602x1502)
    // nearest drops every other cell and thin walls turn to dotted noise.
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(mirror.canvas, view.ox, view.oy, w, h);

    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.extent;
    ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, w + 1, h + 1);

    if (view.scale >= CELL_GRID_MIN_SCALE) drawCellGrid(ctx, view, rect, grid, palette);

    const current = propsRef.current;
    drawPreview(ctx, view, session, gestureRef.current, current, palette);
    drawBrushRing(ctx, view, gestureRef.current, hoverRef.current, current, palette);
    // Above the grid and stroke preview so the wash tints cells; below the
    // robot and markers, which are what to notice inside a zone.
    drawZones(
      ctx,
      view,
      session.meta,
      gestureRef.current,
      hoverCornerRef.current,
      current,
      palette,
    );
    drawZoneDraft(
      ctx,
      view,
      session.meta,
      gestureRef.current,
      hoverRef.current,
      hoverCornerRef.current,
      current,
      palette,
    );
    // Under the markers, so a stop placed where the robot stands stays visible.
    if (current.robotPose) {
      drawRobot(ctx, view, session.meta, current.robotPose, palette);
    }
    // Above the shape preview, so markers are never buried by it.
    drawVertices(ctx, view, session.meta, gestureRef.current, current, palette);
    // Last of all: the band is chrome over everything it is selecting.
    drawMarquee(ctx, gestureRef.current, palette);

    // Publish at most once per frame, and only on a real change.
    const hover = hoverRef.current;
    const hoverKey = hover ? `${hover.col},${hover.row}` : "";
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

  // Repaint on a theme change: the chrome hues move, the grid bytes don't.
  React.useEffect(() => {
    requestDraw();
  }, [theme, requestDraw]);

  /**
   * Repaint when on-screen data changes. The propsRef effect deliberately
   * doesn't draw (tool, brush and value only matter at the next pointer
   * event), so a create landing while the pointer is still would not appear.
   */
  React.useEffect(() => {
    requestDraw();
  }, [
    props.vertices,
    props.draft,
    props.selectedIds,
    props.mode,
    // A clicked corner lands while the pointer is still.
    props.zones,
    props.zoneDraft,
    props.zoneDraftAnchor,
    props.selectedZoneIds,
    // The hook memoises on value, so a parked robot costs no frames.
    props.robotPose,
    requestDraw,
  ]);

  // Fit: drop the transform and let draw() rebuild it from the current rect.
  React.useEffect(() => {
    viewRef.current = null;
    requestDraw();
  }, [props.fitNonce, requestDraw]);

  const zoomStep = props.zoomStep;
  React.useEffect(() => {
    if (!zoomStep) return;
    const view = viewRef.current;
    const rect = rectRef.current;
    // Before the first paint there is no view to zoom; draw() builds the fit.
    if (!view || !rect) return;
    viewRef.current = zoomAt(
      view,
      rect.width / 2,
      rect.height / 2,
      zoomStep.factor,
      rect,
      session.grid,
    );
    requestDraw();
  }, [zoomStep, session, requestDraw]);

  /**
   * Centre on the point the shell asked for. Before the first paint there is
   * no view; draw()'s fit then shows the whole map, target included.
   */
  const focus = props.focus;
  React.useEffect(() => {
    if (!focus) return;
    const view = viewRef.current;
    const rect = rectRef.current;
    if (!view || !rect) return;
    const { px, py } = worldToGrid(focus.x, focus.y, session.meta);
    viewRef.current = centerView(view, px, py, rect, session.grid);
    requestDraw();
  }, [focus, session, requestDraw]);

  React.useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Undo/redo lives in the shell but needs the mirror and frame scheduler,
    // which only this component owns; the slot lives as long as this effect.
    session.repaint = (dirty) => {
      if (dirty) blitGridRect(session.mirror, session.grid, dirty);
      else blitGrid(session.mirror, session.grid);
      requestDraw();
    };

    let previous = rectRef.current;
    const observer = new ResizeObserver(() => {
      const bounds = container.getBoundingClientRect();
      if (bounds.width < 1 || bounds.height < 1) return;
      const next = { width: bounds.width, height: bounds.height };
      // Hold the zoom across a resize (a devtools pane shouldn't lose the
      // view); Fit is the way back.
      if (viewRef.current && previous) {
        viewRef.current = reanchorView(viewRef.current, previous, next, session.grid);
      }
      previous = next;
      rectRef.current = next;
      requestDraw();
    });
    // Observe the container; the canvas is absolutely positioned, since resizing
    // an in-flow canvas would re-trigger this forever.
    observer.observe(container);

    // Not a JSX onWheel: React attaches wheel passively, so preventDefault is
    // ignored and a trackpad pinch (wheel + ctrlKey) page-zooms the console.
    const onWheel = (event: WheelEvent) => {
      const rect = rectRef.current;
      const view = viewRef.current;
      if (!rect || !view) return;
      event.preventDefault();

      const bounds = container.getBoundingClientRect();
      const cx = event.clientX - bounds.left;
      const cy = event.clientY - bounds.top;
    // Shared with the task editor's floor plan (lib/map/gesture.ts).
      const factor = wheelZoomFactor(event.deltaY, event.deltaMode, rect.height);
      viewRef.current = zoomAt(view, cx, cy, factor, rect, session.grid);
      requestDraw();
    };
    container.addEventListener("wheel", onWheel, { passive: false });

    requestDraw();

    return () => {
      observer.disconnect();
      container.removeEventListener("wheel", onWheel);
      session.repaint = null;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [session, requestDraw]);

  /** Container-local CSS pixels. */
  const localPoint = (event: React.PointerEvent) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    rectRef.current = { width: bounds.width, height: bounds.height };
    return { cx: event.clientX - bounds.left, cy: event.clientY - bounds.top };
  };

  /**
   * The cell under a point, clamped so a drag past the edge keeps painting the
   * edge row. A stroke's first press must still land inside.
   */
  const clampedCell = (view: View, cx: number, cy: number): Cell => {
    const { px, py } = screenToGrid(view, cx, cy);
    const grid = session.grid;
    return {
      col: Math.min(Math.max(Math.floor(px), 0), grid.width - 1),
      row: Math.min(Math.max(Math.floor(py), 0), grid.height - 1),
    };
  };

  /**
   * The topmost marker under a point, hit-tested in screen space so the target
   * stays one size at every zoom (markers don't scale). Last-to-first: the one
   * painted on top wins.
   */
  const probeAt = (cell: Cell | null): CellProbe | null => {
    if (!cell) return null;
    return {
      col: cell.col,
      row: cell.row,
      byte: session.grid.data[cell.row * session.grid.width + cell.col],
    };
  };

  const flushStroke = () => {
    const dirty = session.accumulator.takeFrameDirty();
    if (dirty) blitGridRect(session.mirror, session.grid, dirty);
    requestDraw();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view) return;
    if (event.button !== 0 && event.button !== 1 && event.button !== 2) return;

    const { mode, tool, vertexTool, zoneTool, value, brush, spacePan } = propsRef.current;
    const { cx, cy } = localPoint(event);

    if (event.pointerType === "touch") {
      touchesRef.current.set(event.pointerId, { cx, cy });
      // A second finger pinches if the first is panning, holding an unadded
      // zone corner, or idle. Over a stroke, band or aim it is ignored: those
      // have acted, and a zoom would move the map under the cells being painted.
      const gesture = gestureRef.current;
      if (
        touchesRef.current.size === 2 &&
        !pinchRef.current &&
        (!gesture || gesture.kind === "pan" || gesture.kind === "point")
      ) {
        if (gesture) {
          // Ended without the click-pick: two fingers are never a click.
          gestureRef.current = null;
          setPanCursor(false);
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
        // Capture both fingers so neither lift is lost; the first may already be.
        event.currentTarget.setPointerCapture(a[0]);
        event.currentTarget.setPointerCapture(b[0]);
        return;
      }
    }
    // One gesture at a time; a pinch in flight owns both fingers.
    if (gestureRef.current || pinchRef.current) return;

    // Which gesture a press starts is classifyPress (lib/map/gesture.ts); this
    // only acts on it.
    const touch = event.pointerType === "touch";
    const hit =
      mode === "vertex"
        ? vertexAt(
            view,
            session.meta,
            propsRef.current.vertices,
            cx,
            cy,
            touch ? VERTEX_HIT_RADIUS_TOUCH : VERTEX_HIT_RADIUS,
          )
        : null;
    const intent = classifyPress({
      button: event.button,
      spacePan,
      shiftKey: event.shiftKey,
      touch,
      mode,
      tool,
      vertexTool,
      zoneTool,
      onVertex: hit !== null,
    });

    if (intent === "toggle" && hit) {
      event.preventDefault();
      propsRef.current.onVertexToggle(hit.id);
      return;
    }

    if (intent === "marquee") {
      // Anywhere, letterbox included: the band selects markers, not cells.
      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      gestureRef.current = {
        kind: "marquee",
        pointerId: event.pointerId,
        ox: cx,
        oy: cy,
        cx,
        cy,
        additive: event.shiftKey,
      };
      requestDraw();
      return;
    }

    if (intent === "aim") {
      const { draft } = propsRef.current;
      // An existing vertex anchors at its stored position, not the press:
      // using the press would nudge it up to 11 px every time it was selected.
      let anchor: { wx: number; wy: number };
      if (hit) {
        anchor = { wx: hit.x, wy: hit.y };
      } else {
        // Only a press on the grid places one; the letterbox means nothing.
        const cell = cellAt(view, session.grid, cx, cy);
        if (!cell) return;
        // Cell centre, not corner (a 2.5 cm lie at 0.05 m/cell, as in GridStatus).
        anchor = gridToWorld(cell.col + 0.5, cell.row + 0.5, session.meta);
      }

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      propsRef.current.onVertexPick(hit?.id ?? null);

      gestureRef.current = {
        kind: "vertex",
        pointerId: event.pointerId,
        id: hit?.id ?? null,
        wx: anchor.wx,
        wy: anchor.wy,
        cx,
        cy,
        // A click must not snap the heading to 0°: keep the vertex's, or the
        // draft's for a run of points facing the same way.
        theta: hit?.theta ?? draft?.theta ?? 0,
      };
      requestDraw();
      return;
    }

    if (intent === "point") {
      const { zoneDraft, zoneDraftAnchor, zones } = propsRef.current;
      // Only a press on the grid counts; the cell centre, as for a waypoint.
      const cell = cellAt(view, session.grid, cx, cy);
      if (!cell) return;
      const { wx, wy } = gridToWorld(cell.col + 0.5, cell.row + 0.5, session.meta);
      const point = { x: wx, y: wy };
      const under = zoneDraft.length === 0 ? zoneAt(zones, point) : null;
      const corner = cornerUnder(view, cx, cy, touch);
      const anchored = zoneDraftAnchor !== null;
      // A finger has no Shift, so a tap adds to the selection; with a corner
      // down a tap is still the next corner.
      const additive = event.shiftKey || touch;
      const verdict = classifyZonePress({
        count: zoneDraft.length,
        anchored,
        corner: corner && corner.zoneId === null ? corner.index : null,
        onZone: under !== null,
        additive,
        onHandle: corner !== null && corner.zoneId !== null,
      });

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);
      // The release decides click or drag, as for `pan.pick`. A drag pans or
      // moves the corner pressed, which anchors at its stored position until
      // out of the deadzone. Two corners never drag: the shape's copy of the
      // zone's corner (dragging would leave the shape behind), and a finished
      // zone's while a shape is in flight (a click there attaches or ends it).
      const draggable =
        corner !== null &&
        !(corner.zoneId === null && corner.index === zoneDraftAnchor?.position) &&
        !(zoneDraft.length > 0 && corner.zoneId !== null);
      let click: Extract<Gesture, { kind: "point" }>["click"] = { kind: "none" };
      if (verdict === "close") click = { kind: "close" };
      else if (verdict === "select" && under) click = { kind: "select", id: under.id, additive };
      else if (verdict === "add") click = { kind: "add", point };
      else if (verdict === "anchor" && corner) click = { kind: "anchor", corner };
      else if (verdict === "merge" && corner) click = { kind: "merge", corner };
      gestureRef.current = {
        kind: "point",
        pointerId: event.pointerId,
        ox: cx,
        oy: cy,
        cx,
        cy,
        click,
        corner: draggable ? { ...corner, at: cornerPoint(corner) } : null,
      };
      return;
    }

    if (intent === "stroke") {
      // Only a press on the grid starts a stroke; the letterbox means nothing.
      const cell = cellAt(view, session.grid, cx, cy);
      if (!cell) return;

      event.preventDefault();
      event.currentTarget.setPointerCapture(event.pointerId);

      if (tool === "brush") {
        gestureRef.current = { kind: "paint", pointerId: event.pointerId, last: cell };
        stampDisc(session.grid, cell.col, cell.row, brush, value, session.accumulator.sink);
        flushStroke();
      } else {
        gestureRef.current = {
          kind: "shape",
          pointerId: event.pointerId,
          anchor: cell,
          head: cell,
        };
        requestDraw();
      }
      return;
    }

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    gestureRef.current = {
      kind: "pan",
      pointerId: event.pointerId,
      cx,
      cy,
      ox: cx,
      oy: cy,
      pick: panPicks({ button: event.button, spacePan, mode, vertexTool })
        ? { id: hit?.id ?? null }
        : null,
    };
    // An inline style, not a class: a mid-pan re-render (the hover cell
    // changes) would rewrite className and drop it. It is the only sign a
    // right-drag grabbed the map, since Pan isn't the armed tool then.
    setPanCursor(true);
  };

  /** Held on the container itself; see the note in handlePointerDown. */
  const setPanCursor = (grabbing: boolean) => setCursor(grabbing ? "grabbing" : null);

  /**
   * The same inline style for `move` / `pointer` over corners, which change
   * at pointer rate and would otherwise re-render the shell per move.
   */
  const setCursor = (cursor: "grabbing" | "move" | "pointer" | null) => {
    const container = containerRef.current;
    if (container) container.style.cursor = cursor ?? "";
  };

  /**
   * The corner under a screen point, hit-tested like a marker. What's offered
   * follows what a press would do (classifyZonePress): the shape in flight's
   * corners first, then for an anchored shape its zone's other corners;
   * otherwise every finished zone's, the selected ones first so their handles
   * win on a shared corner.
   */
  const cornerUnder = (
    view: View,
    cx: number,
    cy: number,
    touch: boolean,
  ): ZoneCornerRef | null => {
    const { zoneDraft, zoneDraftAnchor, zones, selectedZoneIds } = propsRef.current;
    const radius = touch ? VERTEX_HIT_RADIUS_TOUCH : VERTEX_HIT_RADIUS;
    const hit = (points: readonly ZonePoint[]) =>
      cornerAt(
        points.map((corner) => vertexScreen(view, session.meta, corner.x, corner.y)),
        { cx, cy },
        radius,
      );
    if (zoneDraft.length) {
      const index = hit(zoneDraft);
      if (index !== null) return { zoneId: null, index };
    }
    if (zoneDraftAnchor) {
      const zone = zones.find((entry) => entry.id === zoneDraftAnchor.zoneId);
      const target = zone ? hit(zone.points) : null;
      return target === null || target === zoneDraftAnchor.index
        ? null
        : { zoneId: zoneDraftAnchor.zoneId, index: target };
    }
    const ordered = selectedZoneIds.length
      ? [
          ...zones.filter((zone) => selectedZoneIds.includes(zone.id)),
          ...zones.filter((zone) => !selectedZoneIds.includes(zone.id)),
        ]
      : zones;
    for (const zone of ordered) {
      const index = hit(zone.points);
      if (index !== null) return { zoneId: zone.id, index };
    }
    return null;
  };

  /** Where a corner is stored, so a press anchors there and not at the slop. */
  const cornerPoint = (corner: ZoneCornerRef): ZonePoint => {
    const { zoneDraft, zones } = propsRef.current;
    const points =
      corner.zoneId === null
        ? zoneDraft
        : (zones.find((zone) => zone.id === corner.zoneId)?.points ?? []);
    return points[corner.index];
  };

  const sameCorner = (a: ZoneCornerRef | null, b: ZoneCornerRef | null) =>
    a === b || (a !== null && b !== null && a.zoneId === b.zoneId && a.index === b.index);

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
      // Zoom about the old midpoint, then carry it to the new one, so the map
      // stays pinned under the fingers.
      let next = view;
      if (pinch.dist > 0 && dist > 0) {
        next = zoomAt(next, pinch.cx, pinch.cy, dist / pinch.dist, rect, session.grid);
      }
      viewRef.current = panBy(next, mx - pinch.cx, my - pinch.cy, rect, session.grid);
      pinch.dist = dist;
      pinch.cx = mx;
      pinch.cy = my;
      requestDraw();
      return;
    }
    // Before the hover probe, or the brush ring follows the wrong finger.
    if (gesture && gesture.pointerId !== event.pointerId) return;

    hoverRef.current = probeAt(cellAt(view, session.grid, cx, cy));

    if (!gesture) {
      // With Shape armed a corner under the pointer swells; tested here since
      // draw() only has the cell, not the pointer.
      const { mode, zoneTool, spacePan, zoneDraft, zoneDraftAnchor } = propsRef.current;
      const armed = mode === "zone" && zoneTool === "shape" && !spacePan;
      let corner = armed ? cornerUnder(view, cx, cy, event.pointerType === "touch") : null;
      // The shape's copy of the zone's corner is the zone's and does nothing.
      if (corner && corner.zoneId === null && corner.index === zoneDraftAnchor?.position) {
        corner = null;
      }
      if (!sameCorner(corner, hoverCornerRef.current)) {
        hoverCornerRef.current = corner;
        // A merge target is clicked, not dragged; every other corner drags.
        const target = corner !== null && corner.zoneId !== null && zoneDraft.length > 0;
        setCursor(corner === null ? null : target ? "pointer" : "move");
      }
      requestDraw();
      return;
    }

    if (gesture.kind === "point" && gesture.corner) {
      // A corner drag carries the corner, snapped to cell centres and clamped
      // to the grid.
      if (isDrag(gesture.ox, gesture.oy, cx, cy)) {
        const cell = clampedCell(view, cx, cy);
        const { wx, wy } = gridToWorld(cell.col + 0.5, cell.row + 0.5, session.meta);
        gesture.corner.at = { x: wx, y: wy };
        setCursor("move");
      }
      gesture.cx = cx;
      gesture.cy = cy;
      requestDraw();
      return;
    }

    if (gesture.kind === "pan" || gesture.kind === "point") {
      if (!rect) return;
      // A corner press pans from the first move (the deadzone is the release's
      // question), but the grab cursor waits so a click never flashes one.
      if (gesture.kind === "point" && isDrag(gesture.ox, gesture.oy, cx, cy)) {
        setPanCursor(true);
      }
      viewRef.current = panBy(view, cx - gesture.cx, cy - gesture.cy, rect, session.grid);
      gesture.cx = cx;
      gesture.cy = cy;
      requestDraw();
      return;
    }

    if (gesture.kind === "shape") {
      gesture.head = clampedCell(view, cx, cy);
      requestDraw();
      return;
    }

    if (gesture.kind === "marquee") {
      gesture.cx = cx;
      gesture.cy = cy;
      requestDraw();
      return;
    }

    if (gesture.kind === "vertex") {
      if (isDrag(gesture.cx, gesture.cy, cx, cy)) {
        // y negated: canvas rows grow down, ROS y grows up. Screen space is
        // enough because this canvas is always axis-aligned with the map.
        gesture.theta = headingDegrees(cx - gesture.cx, -(cy - gesture.cy)) ?? gesture.theta;
      }
      requestDraw();
      return;
    }

    const { brush, value } = propsRef.current;
    // Recover the samples merged into this event, or a fast flick loses its
    // curve. Never getPredictedEvents(): retracted predictions would be
    // permanent paint.
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
      stampLine(session.grid, gesture.last, cell, brush, value, session.accumulator.sink);
      gesture.last = cell;
    }
    flushStroke();
  };

  const endGesture = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "touch") touchesRef.current.delete(event.pointerId);
    const pinch = pinchRef.current;
    if (pinch && (event.pointerId === pinch.a || event.pointerId === pinch.b)) {
      // Either lift ends the pinch. The remaining finger starts nothing — a
      // pan from wherever it was would jump the map.
      pinchRef.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      return;
    }
    const gesture = gestureRef.current;
    const view = viewRef.current;
    // The second finger's lift is not the end of the first finger's stroke.
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(gesture.pointerId)) {
      event.currentTarget.releasePointerCapture(gesture.pointerId);
    }

    if (gesture.kind === "pan") {
      setPanCursor(false);
      // A press that never moved is a click: inspects a vertex with Pan armed,
      // or drops a selection on bare map. Same deadzone as the heading, so
      // "did this drag mean anything" has one answer.
      if (gesture.pick && !isDrag(gesture.ox, gesture.oy, gesture.cx, gesture.cy)) {
        propsRef.current.onVertexPick(gesture.pick.id);
      }
      return;
    }

    if (gesture.kind === "point") {
      setCursor(null);
      hoverCornerRef.current = null;
      // A click adds a corner, closes or selects; a drag panned, or carried a
      // corner. The buffer didn't move either way, so no patch.
      if (isDrag(gesture.ox, gesture.oy, gesture.cx, gesture.cy)) {
        if (gesture.corner) {
          const { zoneId, index, at } = gesture.corner;
          propsRef.current.onZoneCornerMove({ zoneId, index }, at);
        }
      } else {
        const { click } = gesture;
        if (click.kind === "add") propsRef.current.onZonePoint(click.point);
        else if (click.kind === "close") propsRef.current.onZoneClose();
        else if (click.kind === "select") propsRef.current.onZonePick(click.id, click.additive);
        else if (click.kind === "anchor") propsRef.current.onZoneAnchor(click.corner);
        else if (click.kind === "merge") propsRef.current.onZoneMerge(click.corner);
      }
      requestDraw();
      return;
    }

    if (gesture.kind === "marquee") {
      const { ox, oy, cx, cy, additive } = gesture;
      const band = bandBetween(ox, oy, cx, cy);

      // A band that never opened is a click on bare map, which clears — the
      // Pan tool's verdict too.
      if (bandIsClick(band)) {
        if (!additive) propsRef.current.onVertexPick(null);
        requestDraw();
        return;
      }

      // Projected with the band's view; membership is idsInBand's rule.
      const ids = view
        ? idsInBand(
            band,
            propsRef.current.vertices.map((vertex) => ({
              id: vertex.id,
              ...vertexScreen(view, session.meta, vertex.x, vertex.y),
            })),
          )
        : [];
      propsRef.current.onMarquee(ids, additive);
      requestDraw();
      return;
    }

    if (gesture.kind === "vertex") {
      // The buffer didn't move, so no patch: an empty one would be an undo
      // entry that undoes nothing.
      propsRef.current.onVertexGesture({
        id: gesture.id,
        pose: { x: gesture.wx, y: gesture.wy, theta: gesture.theta },
      });
      requestDraw();
      return;
    }

    const { brush, value } = propsRef.current;
    if (gesture.kind === "shape" && view) {
      const { anchor, head } = gesture;
      if (propsRef.current.tool === "rect") {
        stampRect(session.grid, anchor, head, value, session.accumulator.sink);
      } else {
        stampLine(session.grid, anchor, head, brush, value, session.accumulator.sink);
      }
      flushStroke();
    }

    const patch = session.accumulator.commit();
    if (patch) propsRef.current.onStrokeCommit(patch);
    requestDraw();
  };

  /**
   * A cancelled pointer commits the stroke: the buffer is already mutated, and
   * an edit undo can't reach is worse than a short stroke.
   */
  const handlePointerCancel = endGesture;

  const panCursor =
    (props.mode === "grid" && props.tool === "pan") ||
    (props.mode === "vertex" && props.vertexTool === "pan") ||
    (props.mode === "zone" && props.zoneTool === "pan") ||
    props.spacePan
      ? "cursor-grab active:cursor-grabbing"
      : "";

  return (
    <div
      ref={containerRef}
      // touch-none, or a touch drag scrolls the page and fires pointercancel.
      className={cn(
        "relative h-full w-full touch-none overflow-hidden select-none",
        panCursor || "cursor-crosshair",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={handlePointerCancel}
      // Right-drag pans, so no context menu: it would swallow the pointerup
      // and leave the pan stuck to the cursor.
      onContextMenu={(event) => event.preventDefault()}
      onPointerLeave={() => {
        if (gestureRef.current) return;
        hoverRef.current = null;
        hoverCornerRef.current = null;
        setCursor(null);
        requestDraw();
      }}
    >
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
    </div>
  );
});

