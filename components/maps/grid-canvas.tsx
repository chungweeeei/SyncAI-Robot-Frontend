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
  drawBrushRing,
  drawCellGrid,
  drawMarquee,
  drawPreview,
  drawRobot,
  drawVertices,
  vertexScreen,
} from "@/lib/map/draw";
import type {
  CellProbe,
  EditMode,
  EditTool,
  Gesture,
  VertexGesture,
  VertexTool,
} from "@/lib/map/editor";
import { blitGrid, blitGridRect } from "@/lib/map/render";
import type { GridPatch } from "@/lib/map/patch";
import type { GridSession } from "@/lib/map/session";
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

/** Click slop around a marker centre. Comfortably larger than the dot itself. */
const VERTEX_HIT_RADIUS = 11;
/** Below this drag distance the gesture is a click and the heading is kept. */
const HEADING_DEADZONE_PX = 10;

const ZOOM_PER_PX = 0.0015;
const WHEEL_LINE_PX = 16;

export interface GridCanvasProps {
  session: GridSession;
  /** Grid paints cells; vertex places poses and never touches the buffer. */
  mode: EditMode;
  tool: EditTool;
  /** Read only in vertex mode, the way `tool` is read only in grid mode. */
  vertexTool: VertexTool;
  value: GridValue;
  /** Odd cell diameter from BRUSH_SIZES. */
  brush: number;
  /** True while the shell sees Space held — pans without changing the tool. */
  spacePan: boolean;
  /**
   * Bumped by the shell's Fit action. A nonce rather than a callback the shell
   * holds: the view lives in here, and handing out a setter would give the shell a
   * second way to reach it.
   */
  fitNonce: number;
  /**
   * A map-frame point to bring to the centre of the viewport, holding the zoom.
   *
   * Identity is the trigger — a fresh object means "do it now", the same job
   * `fitNonce` does with a counter — so the shell hands one over per request and
   * leaves it in place afterwards. Null means nothing has asked.
   *
   * It exists for the robot-position capture: that draft appears without a
   * pointer gesture, so its marker can land anywhere, including off screen, and
   * an operator with a staged pose they cannot see has no way to judge it.
   */
  focus: { x: number; y: number } | null;
  /**
   * Once per completed stroke, never mid-drag. The grid and the mirror are already
   * updated by then; the shell's only job is to record the patch.
   */
  onStrokeCommit: (patch: GridPatch) => void;
  /** Coalesced to at most one call per frame, and only when the cell changes. */
  onHover: (probe: CellProbe | null) => void;
  /** Coalesced the same way. */
  onScaleChange: (scale: number) => void;

  /** Vertices already stored for this map. Drawn in every mode. */
  vertices: MapVertex[];
  /**
   * Where the robot is standing on this map, or null when that is not knowable
   * (another map loaded, not localized, no state) — see useRobotMapPose.
   *
   * Drawn in every mode, like the vertices: it is the answer to "which end of the
   * corridor am I looking at", which is as useful with a brush in hand as it is
   * while placing stops. It is never interactive — nothing on this canvas can
   * move the robot, and hit-testing ignores it entirely.
   */
  robotPose: PlanarPose | null;
  /** Staged, not-yet-created vertex. Drawn in the commanded hue. */
  draft: PlanarPose | null;
  /**
   * Highlighted. One of them is the vertex the panel is editing; more than one
   * is a band selection, which the panel can only delete.
   *
   * A list rather than a Set because it is the shell's state and is handed
   * straight to React.memo — a Set rebuilt per render would defeat it, and the
   * only thing this component does with it is a membership test per frame,
   * which it builds its own Set for.
   */
  selectedIds: readonly string[];
  /** Fired on pointer-down, before any drag, so selection feels immediate. */
  onVertexPick: (id: string | null) => void;
  /** Shift-click on a marker: add it to, or drop it from, the selection. */
  onVertexToggle: (id: string) => void;
  /**
   * A finished rubber band, with the ids whose markers it enclosed — possibly
   * none, which is a real answer and clears the selection unless `additive`.
   */
  onMarquee: (ids: string[], additive: boolean) => void;
  /** Fired once on pointer-up with the finished pose. */
  onVertexGesture: (gesture: VertexGesture) => void;

  className?: string;
}

/**
 * The editable grid: the only component in the editor that touches pixels or
 * pointer events.
 *
 * The invariant inherited from the 2D map canvas this replaces is that there is
 * exactly one view transform and `draw()` and every handler read the same one.
 * Here it is mutable, so the rule is sharper: `viewRef.current` is the single
 * instance, handlers write it and then ask for a frame, and it is never copied into
 * React state — a pan at pointer rate must not re-render the toolbar.
 */
export const GridCanvas = React.memo(function GridCanvas(props: GridCanvasProps) {
  const { session, className } = props;
  const { resolvedTheme } = useTheme();

  const containerRef = React.useRef<HTMLDivElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const viewRef = React.useRef<View | null>(null);
  /**
   * Cached container size. getBoundingClientRect() inside pointermove is a forced
   * layout read, and combined with the hover readout writing DOM text in the same
   * frame it is layout thrash on every mouse move.
   */
  const rectRef = React.useRef<{ width: number; height: number } | null>(null);
  const gestureRef = React.useRef<Gesture | null>(null);
  const hoverRef = React.useRef<CellProbe | null>(null);
  const rafRef = React.useRef(0);
  const drawRef = React.useRef<(() => void) | null>(null);
  const publishedHoverRef = React.useRef<string>("");
  const publishedScaleRef = React.useRef(0);

  /**
   * The draw/listener effect must not re-subscribe when a callback identity, the
   * tool or the brush size changes: it owns a ResizeObserver and a non-passive
   * wheel listener, and re-running it mid-drag would drop pointer capture and the
   * in-flight stroke. It reads everything current through here instead.
   */
  const propsRef = React.useRef(props);
  React.useEffect(() => {
    propsRef.current = props;
  });

  const theme: "light" | "dark" = resolvedTheme === "dark" ? "dark" : "light";
  const themeRef = React.useRef(theme);
  themeRef.current = theme;

  /**
   * Draw-on-change, coalesced to one paint per frame.
   *
   * Not a persistent rAF loop: nothing on this screen animates, the 3D viewport
   * already owns one, and this console can be running on the robot's own Jetson.
   * Not a bare draw() per event either — a trackpad pinch delivers a dozen wheel
   * events per frame, and a resize plus a wheel in the same frame must paint once.
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
    // A flex child's first layout pass can be 0x0. Bailing is not just a skipped
    // frame here: fitView on a zero rect gives scale 0, screenToGrid then divides
    // by it, and the resulting NaN transform never recovers.
    if (bounds.width < 1 || bounds.height < 1) return;
    const rect = { width: bounds.width, height: bounds.height };
    rectRef.current = rect;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(rect.width * dpr);
    const bh = Math.round(rect.height * dpr);
    // Only on change: assigning width/height clears the surface and resets the
    // transform, which is a wasted full realloc at pointer rate.
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // DPR lives here and nowhere else — the view transform stays in CSS pixels,
    // the same unit event.clientX reports, so hit-testing needs no DPR term.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = PALETTES[themeRef.current];
    ctx.fillStyle = palette.well;
    ctx.fillRect(0, 0, rect.width, rect.height);

    if (!viewRef.current) viewRef.current = fitView(rect, session.grid);
    const view = viewRef.current;
    const { grid, mirror } = session;
    const w = grid.width * view.scale;
    const h = grid.height * view.scale;

    // Nearest-neighbour at or above 1:1 — a smoothed cell boundary would lie about
    // which cell the next click lands in. Below 1:1 the browser's filtered
    // downscale is the honest choice: fit scale on the 1602x1502 maps is ~0.47, and
    // nearest sampling there drops every other cell, so 1-to-3-cell-thick walls
    // break into dotted noise exactly when you are trying to judge them.
    ctx.imageSmoothingEnabled = view.scale < 1;
    ctx.drawImage(mirror.canvas, view.ox, view.oy, w, h);

    ctx.lineWidth = 1;
    ctx.strokeStyle = palette.extent;
    ctx.strokeRect(view.ox - 0.5, view.oy - 0.5, w + 1, h + 1);

    if (view.scale >= CELL_GRID_MIN_SCALE) drawCellGrid(ctx, view, rect, grid, palette);

    const current = propsRef.current;
    drawPreview(ctx, view, session, gestureRef.current, current, palette);
    drawBrushRing(ctx, view, gestureRef.current, hoverRef.current, current, palette);
    // Under the vertex layer: the markers are what this screen edits, and a stop
    // placed where the robot is standing must not disappear beneath it.
    if (current.robotPose) {
      drawRobot(ctx, view, session.meta, current.robotPose, palette);
    }
    // Above the shape preview, so markers are never buried by it.
    drawVertices(ctx, view, session.meta, gestureRef.current, current, palette);
    // Last of all: the band is chrome over everything it is selecting.
    drawMarquee(ctx, gestureRef.current, palette);

    // Publish at most once per frame, and only on a real change: moving within one
    // cell at high zoom, or a pan that does not change the scale, costs nothing.
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

  // Repaint on a theme change: the grid bytes do not move, but the chrome hues do.
  React.useEffect(() => {
    requestDraw();
  }, [theme, requestDraw]);

  /**
   * Repaint when the vertex layer changes.
   *
   * Necessary because the propsRef effect above deliberately does not draw: the
   * tool, the brush and the paint value only matter at the *next* pointer event,
   * so a render caused by one of them costs no frame. Vertex data is different —
   * it is on screen, and a create that lands while the pointer is still would
   * otherwise not appear until something else happened to ask for a frame.
   */
  React.useEffect(() => {
    requestDraw();
  }, [
    props.vertices,
    props.draft,
    props.selectedIds,
    props.mode,
    // Once a second at most, and only when the robot has actually moved — the
    // hook memoises the pose on its values, so a parked robot costs no frames.
    props.robotPose,
    requestDraw,
  ]);

  // Fit: drop the transform and let draw() rebuild it from the current rect.
  React.useEffect(() => {
    viewRef.current = null;
    requestDraw();
  }, [props.fitNonce, requestDraw]);

  /**
   * Centre on a point the shell asked for, if there is a view to move.
   *
   * Before the first paint there is neither a transform nor a measured rect, and
   * nothing to do: draw() then builds the fit view, which has the whole map —
   * and so the target — on screen anyway.
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

    // Undo/redo lives in the shell but has to reach the mirror and the frame
    // scheduler, which only this component owns. The slot's lifetime is exactly
    // this effect's.
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
      // Hold the zoom across a resize rather than refitting — a window resize or a
      // devtools pane must not throw away the view the operator set up. "Fit" is
      // the explicit way back.
      if (viewRef.current && previous) {
        viewRef.current = reanchorView(viewRef.current, previous, next, session.grid);
      }
      previous = next;
      rectRef.current = next;
      requestDraw();
    });
    // The container only, and the canvas stays absolutely positioned: assigning
    // width on an in-flow canvas changes layout and would re-trigger this forever.
    observer.observe(container);

    // Wheel cannot be a JSX onWheel prop. React attaches wheel passively at the
    // root, so preventDefault() there is ignored with a console warning — and
    // without it a trackpad pinch (which arrives as wheel + ctrlKey) page-zooms
    // the whole console instead of the map.
    const onWheel = (event: WheelEvent) => {
      const rect = rectRef.current;
      const view = viewRef.current;
      if (!rect || !view) return;
      event.preventDefault();

      const bounds = container.getBoundingClientRect();
      const cx = event.clientX - bounds.left;
      const cy = event.clientY - bounds.top;
      // deltaMode 1 is lines (Firefox) and 2 is pages; a raw deltaY would zoom
      // ~16x per notch there. Exponential rather than 1 + k*delta so zoom is
      // multiplicative: N notches up then N down returns to the same scale.
      const unit =
        event.deltaMode === 1 ? WHEEL_LINE_PX : event.deltaMode === 2 ? rect.height : 1;
      const factor = Math.exp(-event.deltaY * unit * ZOOM_PER_PX);
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
   * The cell under a point, clamped into the grid.
   *
   * Clamped rather than nulled so a drag that wanders past the edge keeps painting
   * the edge row, which is what every paint program does. The press that *starts* a
   * stroke still has to land inside (see handlePointerDown).
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
   * The topmost vertex marker under a point, or null.
   *
   * Hit-tested in screen space rather than in metres so the target stays the
   * same size at every zoom — the marker does not scale, so a world-space radius
   * would be unclickable zoomed out and enormous zoomed in. Last-to-first
   * because that is paint order reversed: the marker drawn on top wins.
   */
  const vertexAt = (view: View, cx: number, cy: number): MapVertex | null => {
    const { vertices } = propsRef.current;
    for (let i = vertices.length - 1; i >= 0; i -= 1) {
      const vertex = vertices[i];
      const at = vertexScreen(view, session.meta, vertex.x, vertex.y);
      if (Math.hypot(at.cx - cx, at.cy - cy) <= VERTEX_HIT_RADIUS) return vertex;
    }
    return null;
  };

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

    const { mode, tool, vertexTool, value, brush, spacePan } = propsRef.current;
    const { cx, cy } = localPoint(event);
    // Right and middle drag always pan, in every mode and whatever the tool.
    //
    // This is the dashboard's bargain, adapted: there, left-drag moves the view
    // and an armed pick mode is what takes the button away. Same here — both
    // modes open in Pan (see DEFAULT_TOOL / DEFAULT_VERTEX_TOOL) and arming a
    // brush or the vertex Place tool is what claims the left button. Right and
    // middle keep panning regardless, so the operator never has to disarm to
    // reach another part of the map. Right is the one that is free: a 2D canvas
    // has no orbit to compete for it, unlike the point-cloud viewport where
    // right-drag is the orbit.
    //
    // Each mode reads its own tool and ignores the other's, which is what keeps
    // the mode toggle from carrying an armed tool across with it.
    const panning =
      event.button === 1 ||
      event.button === 2 ||
      spacePan ||
      (mode === "grid" && tool === "pan") ||
      (mode === "vertex" && vertexTool === "pan");

    if (!panning && mode === "vertex") {
      const { draft } = propsRef.current;
      const hit = vertexAt(view, cx, cy);

      if (vertexTool === "select") {
        // Shift on a marker toggles it, and arms nothing: building a selection
        // one awkward vertex at a time is the half of multi-select a rectangle
        // cannot do, and a re-aim drag starting from a Shift-press would be an
        // edit the operator was not asking for.
        if (hit && event.shiftKey) {
          event.preventDefault();
          propsRef.current.onVertexToggle(hit.id);
          return;
        }

        // Bare map with Select armed is a rubber band. It starts anywhere,
        // including the letterbox margin outside the grid — the band selects
        // markers, not cells, so there is nothing for it to be outside of.
        if (!hit) {
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
        // A plain press on a marker falls through: selecting and re-aiming one
        // vertex works the same under both vertex tools, so the operator does
        // not have to remember which one they are holding to fix a heading.
      }

      // An existing vertex anchors at its *stored* position, not at the press
      // point. The press has to land within VERTEX_HIT_RADIUS of the marker, so
      // using it would silently move the vertex by up to 11 px worth of metres
      // every time the operator merely selected one to re-aim it.
      let anchor: { wx: number; wy: number };
      if (hit) {
        anchor = { wx: hit.x, wy: hit.y };
      } else {
        // Reaching here means the Place tool: a bare-map press with Select armed
        // became the marquee above. Only a press on the grid places a vertex; the
        // map is letterboxed and a press in the margin means nothing, exactly as
        // it does for a stroke.
        const cell = cellAt(view, session.grid, cx, cy);
        if (!cell) return;
        // Cell centre, not corner: gridToWorld(col, row) is the corner, and at
        // 0.05 m/cell reporting that as the pose is a 2.5 cm lie — the same
        // reason GridStatus offsets its readout by half a cell.
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
        // Inside the deadzone the gesture is a click, and a click must not snap
        // the heading to 0°: keep the vertex's own, or the draft's if the
        // operator is placing a run of points facing the same way.
        theta: hit?.theta ?? draft?.theta ?? 0,
      };
      requestDraw();
      return;
    }

    if (!panning) {
      // Only a press that lands on the grid starts a stroke; the map is letterboxed
      // in the viewport and a press in the margin means nothing.
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
      pick:
        mode === "vertex" && vertexTool === "pan" && event.button === 0 && !spacePan
          ? { id: vertexAt(view, cx, cy)?.id ?? null }
          : null,
    };
    // An inline style rather than a class, because the className is React's and a
    // render lands mid-pan routinely: panning changes the hovered cell, draw()
    // publishes that to the shell, and the re-render would rewrite className and
    // drop the class again. `style.cursor` is not managed by React here, so it
    // survives. This is the only feedback that a right-drag grabbed the map, since
    // the Pan tool is not selected in that case.
    setPanCursor(true);
  };

  /** Held on the container itself; see the note in handlePointerDown. */
  const setPanCursor = (grabbing: boolean) => {
    const container = containerRef.current;
    if (container) container.style.cursor = grabbing ? "grabbing" : "";
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const view = viewRef.current;
    if (!view) return;

    const rect = rectRef.current;
    const { cx, cy } = localPoint(event);
    const gesture = gestureRef.current;

    hoverRef.current = probeAt(cellAt(view, session.grid, cx, cy));

    if (!gesture) {
      requestDraw();
      return;
    }

    if (gesture.kind === "pan") {
      if (!rect) return;
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
      const dragPx = Math.hypot(cx - gesture.cx, cy - gesture.cy);
      if (dragPx >= HEADING_DEADZONE_PX) {
        // The y term is negated because canvas rows grow downward while ROS y
        // grows upward — the same flip worldToGrid applies. Screen-space is
        // enough here (unlike the 3D viewport, which has to raycast the floor
        // because the camera can look from any azimuth): this canvas is always
        // axis-aligned with the map and never rotated.
        gesture.theta = (Math.atan2(-(cy - gesture.cy), cx - gesture.cx) * 180) / Math.PI;
      }
      requestDraw();
      return;
    }

    const { brush, value } = propsRef.current;
    // Recover the samples the browser merged into this event: a fast flick is
    // otherwise a handful of far-apart points, and interpolating between only
    // those loses the curve. Never getPredictedEvents() — predictions get
    // retracted, and retracted paint would be permanent.
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
    const gesture = gestureRef.current;
    const view = viewRef.current;
    if (!gesture) return;
    gestureRef.current = null;
    if (event.currentTarget.hasPointerCapture(gesture.pointerId)) {
      event.currentTarget.releasePointerCapture(gesture.pointerId);
    }

    if (gesture.kind === "pan") {
      setPanCursor(false);
      // A press that never really moved was a click, not a drag. With Pan armed
      // in vertex mode that is how a vertex is inspected without disarming, and
      // a click on bare map is how a selection is dropped. It reuses the heading
      // deadzone rather than introducing a second threshold, so "did this drag
      // mean anything" has one answer everywhere on this canvas.
      if (
        gesture.pick &&
        Math.hypot(gesture.cx - gesture.ox, gesture.cy - gesture.oy) <
          HEADING_DEADZONE_PX
      ) {
        propsRef.current.onVertexPick(gesture.pick.id);
      }
      return;
    }

    if (gesture.kind === "marquee") {
      const { ox, oy, cx, cy, additive } = gesture;
      const left = Math.min(ox, cx);
      const right = Math.max(ox, cx);
      const top = Math.min(oy, cy);
      const bottom = Math.max(oy, cy);

      // A band that never opened is a click on bare map, and a click on bare map
      // clears — the same verdict the Pan tool reaches above, so the two tools
      // cannot disagree about what pressing nothing means.
      if (right - left < HEADING_DEADZONE_PX && bottom - top < HEADING_DEADZONE_PX) {
        if (!additive) propsRef.current.onVertexPick(null);
        requestDraw();
        return;
      }

      // Marker centres, not their hit radii: a vertex is a pose and has no
      // extent, so "inside the band" is the only test that matches what the
      // operator drew a rectangle around.
      const ids: string[] = [];
      if (view) {
        for (const vertex of propsRef.current.vertices) {
          const at = vertexScreen(view, session.meta, vertex.x, vertex.y);
          if (at.cx >= left && at.cx <= right && at.cy >= top && at.cy <= bottom) {
            ids.push(vertex.id);
          }
        }
      }
      propsRef.current.onMarquee(ids, additive);
      requestDraw();
      return;
    }

    if (gesture.kind === "vertex") {
      // Nothing in the cell buffer moved, so the accumulator is not consulted
      // and no patch is pushed. Committing an empty patch here would put an
      // entry in the undo stack that undoes nothing, which is worse than no
      // undo at all — the operator would press it and watch a real edit survive.
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
   * A cancelled pointer commits the stroke rather than discarding it. The buffer
   * was already mutated by the time the browser took the pointer away, and leaving
   * an edit that undo cannot reach is strictly worse than an unexpectedly short
   * stroke.
   */
  const handlePointerCancel = endGesture;

  const panCursor =
    (props.mode === "grid" && props.tool === "pan") ||
    (props.mode === "vertex" && props.vertexTool === "pan") ||
    props.spacePan
      ? "cursor-grab active:cursor-grabbing"
      : "";

  return (
    <div
      ref={containerRef}
      // touch-none: without it a touch drag scrolls the page instead of painting,
      // and the browser fires pointercancel the moment it decides that is a scroll.
      className={cn(
        "relative h-full w-full touch-none overflow-hidden select-none",
        panCursor || "cursor-crosshair",
        className,
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endGesture}
      onPointerCancel={handlePointerCancel}
      // Right-drag pans, so the context menu has to go: without this, the menu
      // opens on mouseup over the canvas and swallows the pointerup that ends the
      // gesture, leaving the pan stuck to the cursor. There is nothing on this
      // canvas a browser context menu offers anyway — no text, no image to save.
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

