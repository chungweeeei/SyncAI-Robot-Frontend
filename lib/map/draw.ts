// The floor plan editor's 2D drawing: `(ctx, view, …) -> void`, no React. The
// component owns the buffer, gestures and frame scheduling; this owns what a
// frame looks like. Signal hues come from lib/theme/signal.ts; only the hues
// this editor adds are written out below.

import type { CellSink } from "@/lib/map/grid";
import { stampLine } from "@/lib/map/grid";
import type { CellProbe, DrawState, Gesture } from "@/lib/map/editor";
import type { GridSession } from "@/lib/map/session";
import { vertexGlyph } from "@/lib/map/vertex";
import {
  canCloseZone,
  type ZoneCornerRef,
  type ZonePoint,
  type ZonePolygon,
} from "@/lib/map/zone";
import { SIGNAL, cssHex } from "@/lib/theme/signal";
import {
  gridToScreen,
  screenToGrid,
  worldToGrid,
  type View,
} from "@/lib/map/view";
import type { MapMetadata, PlanarPose } from "@/lib/types/robot";

export interface Palette {
  /** The area outside the map. */
  well: string;
  /** Hairline around the grid extent. */
  extent: string;
  /** Cell gridlines at high zoom. */
  cellGrid: string;
  /** Brush outline and shape preview — a commanded value the operator set. */
  cmd: string;
  /**
   * Stored vertices, one hue for every type (the type is a glyph). Not a
   * signal hue: a saved vertex is neither measured, commanded nor faulted. The
   * draft vertex uses `cmd`.
   */
  vertex: string;
  /** The robot's footprint: `signal-live`, the one measured value on this canvas. */
  live: string;
  /** A forbidden zone: `signal-warn`, not `caution` — a prohibition, not a degraded reading. */
  warn: string;
}

/*
 * Only the chrome drawn *over* the grid follows the theme; the grid is blitted
 * literally (lib/map/render.ts) and stays white/near-black in dark mode too.
 */
export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    well: cssHex(SIGNAL.light.elevated),
    extent: "#8b9aa5",
    cellGrid: "#b9c6ce",
    cmd: cssHex(SIGNAL.light.cmd),
    vertex: "#2f4a58",
    live: cssHex(SIGNAL.light.live),
    warn: cssHex(SIGNAL.light.warn),
  },
  dark: {
    well: "#22282c",
    extent: "#5c6a74",
    cellGrid: "#3a444b",
    cmd: cssHex(SIGNAL.dark.cmd),
    vertex: "#a8bcc7",
    live: cssHex(SIGNAL.dark.live),
    warn: cssHex(SIGNAL.dark.warn),
  },
};

/**
 * Stroked under every mark before its colour. The grid beneath is blitted
 * literally (white free space, near-black obstacles), so no single hue is
 * legible over both; the halo is what makes a mark readable anywhere.
 */
export const MARKER_HALO = "rgba(255, 255, 255, 0.85)";

/** Above this many preview cells, outline the shape instead of filling cells. */
export const PREVIEW_CELL_LIMIT = 4000;

/** Smallest on-screen brush ring, so a 1-cell brush stays findable zoomed out. */
export const MIN_RING_PX = 6;

/*
 * Vertex markers are CSS pixels and do NOT scale with zoom, unlike the brush
 * ring: a vertex is a pose with no size, and scaling it would make it vanish
 * at fit view, where the operator is most likely looking for it.
 */
export const VERTEX_DOT_RADIUS = 4.5;
export const VERTEX_ARROW_PX = 18;

/*
 * The robot's footprint in metres, drawn to scale, because "will it fit" is
 * what the operator is asking. From the global costmap's half-extents
 * (0.35 x 0.22; the local costmap's differ), so it is a picture, not a
 * clearance guarantee.
 */
export const ROBOT_LENGTH_M = 0.7;
export const ROBOT_WIDTH_M = 0.44;

/**
 * Smallest the footprint is drawn, along its length: at fit scale a 0.7 m
 * robot is ~7 px. Below this it becomes a glyph (aspect held) rather than to
 * scale, and at that size nothing reads as a clearance anyway.
 */
export const MIN_ROBOT_LENGTH_PX = 14;

export function drawCellGrid(
  ctx: CanvasRenderingContext2D,
  view: View,
  rect: { width: number; height: number },
  grid: { width: number; height: number },
  palette: Palette,
): void {
  // Only the visible cell range: at scale 32 on a 1602-wide map, iterating every
  // column would be 1600 strokes for the ~30 on screen.
  const from = screenToGrid(view, 0, 0);
  const to = screenToGrid(view, rect.width, rect.height);
  const colFrom = Math.max(Math.ceil(from.px), 0);
  const colTo = Math.min(Math.floor(to.px), grid.width);
  const rowFrom = Math.max(Math.ceil(from.py), 0);
  const rowTo = Math.min(Math.floor(to.py), grid.height);

  ctx.strokeStyle = palette.cellGrid;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let col = colFrom; col <= colTo; col += 1) {
    const x = Math.round(gridToScreen(view, col, 0).cx) + 0.5;
    ctx.moveTo(x, Math.max(view.oy, 0));
    ctx.lineTo(x, Math.min(view.oy + grid.height * view.scale, rect.height));
  }
  for (let row = rowFrom; row <= rowTo; row += 1) {
    const y = Math.round(gridToScreen(view, 0, row).cy) + 0.5;
    ctx.moveTo(Math.max(view.ox, 0), y);
    ctx.lineTo(Math.min(view.ox + grid.width * view.scale, rect.width), y);
  }
  ctx.stroke();
}

/**
 * The in-progress line or rect.
 *
 * A line's preview runs the *same* stampLine that will commit it, into a
 * collector, so highlighted and painted cells cannot disagree; ctx.lineWidth
 * would show different cells at high zoom. A rect's cells *are* a rectangle.
 */
export function drawPreview(
  ctx: CanvasRenderingContext2D,
  view: View,
  session: GridSession,
  gesture: Gesture | null,
  props: DrawState,
  palette: Palette,
): void {
  if (!gesture || gesture.kind !== "shape") return;
  const { anchor, head } = gesture;
  const { grid } = session;

  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = palette.cmd;

  if (props.tool === "rect") {
    const colFrom = Math.min(anchor.col, head.col);
    const rowFrom = Math.min(anchor.row, head.row);
    const cols = Math.abs(head.col - anchor.col) + 1;
    const rows = Math.abs(head.row - anchor.row) + 1;
    const { cx, cy } = gridToScreen(view, colFrom, rowFrom);
    ctx.fillRect(cx, cy, cols * view.scale, rows * view.scale);
    ctx.restore();
    return;
  }

  const cells: number[] = [];
  let overflow = false;
  const collect: CellSink = (index) => {
    if (cells.length >= PREVIEW_CELL_LIMIT) {
      overflow = true;
      return;
    }
    cells.push(index);
  };
  stampLine(grid, anchor, head, props.brush, props.value, collect);

  if (overflow) {
    // Zoomed far out, where individual cells are sub-pixel anyway.
    const a = gridToScreen(view, anchor.col + 0.5, anchor.row + 0.5);
    const b = gridToScreen(view, head.col + 0.5, head.row + 0.5);
    ctx.strokeStyle = palette.cmd;
    ctx.lineWidth = Math.max(props.brush * view.scale, 1);
    ctx.beginPath();
    ctx.moveTo(a.cx, a.cy);
    ctx.lineTo(b.cx, b.cy);
    ctx.stroke();
    ctx.restore();
    return;
  }

  const size = Math.max(view.scale, 1);
  for (const index of cells) {
    const col = index % grid.width;
    const row = (index - col) / grid.width;
    const { cx, cy } = gridToScreen(view, col, row);
    ctx.fillRect(cx, cy, size, size);
  }
  ctx.restore();
}

/** The brush footprint at `brush * scale` CSS px: scaled, so it shows what a click paints. */
export function drawBrushRing(
  ctx: CanvasRenderingContext2D,
  view: View,
  gesture: Gesture | null,
  hover: CellProbe | null,
  props: DrawState,
  palette: Palette,
): void {
  // Nothing is being painted outside grid mode, so a footprint would be a
  // promise about cells that no press there will touch.
  if (props.mode !== "grid") return;
  if (!hover || props.tool === "pan" || props.spacePan) return;
  if (gesture?.kind === "pan") return;

  const diameter = props.tool === "rect" ? 1 : props.brush;
  const { cx, cy } = gridToScreen(view, hover.col + 0.5, hover.row + 0.5);
  const size = Math.max(diameter * view.scale, MIN_RING_PX);

  ctx.strokeStyle = palette.cmd;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    Math.round(cx - size / 2) + 0.5,
    Math.round(cy - size / 2) + 0.5,
    size,
    size,
  );
}

/** A map-frame pose in container-local CSS pixels, via the one view transform. */
export function vertexScreen(view: View, meta: MapMetadata, wx: number, wy: number) {
  const { px, py } = worldToGrid(wx, wy, meta);
  return gridToScreen(view, px, py);
}

/**
 * The vertex layer: stored vertices, the staged draft, and the one being aimed.
 * Drawn in every mode: a grid edit next to a waypoint needs to see it, and the
 * mode switch changes what a press does, not what data is shown.
 */
export function drawVertices(
  ctx: CanvasRenderingContext2D,
  view: View,
  meta: MapMetadata,
  gesture: Gesture | null,
  props: DrawState,
  palette: Palette,
): void {
  const aiming = gesture?.kind === "vertex" ? gesture : null;
  // Rebuilt per frame: a Set prop would be a new identity every render and
  // defeat the memo, and the selection is a few dozen ids at most.
  const selected = new Set(props.selectedIds);

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const vertex of props.vertices) {
    // Mid-gesture the aimed vertex follows the pointer rather than its stored
    // heading; committing is the panel's job, so the row itself has not moved.
    const live = aiming?.id === vertex.id;
    const lit = live || selected.has(vertex.id);
    const at = vertexScreen(view, meta, vertex.x, vertex.y);
    drawMarker(ctx, {
      cx: at.cx,
      cy: at.cy,
      theta: live ? aiming.theta : vertex.theta,
      colour: lit ? palette.cmd : palette.vertex,
      emphasis: lit,
      glyph: vertexGlyph(vertex.type),
      label: vertex.name,
      dashed: false,
    });
  }

  // A draft is drawn last and dashed: the one mark not saved yet.
  const draft = aiming && aiming.id === null ? { ...aiming, x: aiming.wx, y: aiming.wy } : props.draft;
  if (draft) {
    const at = vertexScreen(view, meta, draft.x, draft.y);
    drawMarker(ctx, {
      cx: at.cx,
      cy: at.cy,
      theta: draft.theta,
      colour: palette.cmd,
      emphasis: true,
      glyph: null,
      label: null,
      dashed: true,
    });
  }

  ctx.restore();
}

/** The rubber band, in `cmd`; the wash is faint so the markers it catches stay visible. */
export function drawMarquee(
  ctx: CanvasRenderingContext2D,
  gesture: Gesture | null,
  palette: Palette,
): void {
  if (!gesture || gesture.kind !== "marquee") return;

  const x = Math.min(gesture.ox, gesture.cx);
  const y = Math.min(gesture.oy, gesture.cy);
  const width = Math.abs(gesture.cx - gesture.ox);
  const height = Math.abs(gesture.cy - gesture.oy);

  ctx.save();
  ctx.fillStyle = palette.cmd;
  ctx.globalAlpha = 0.1;
  ctx.fillRect(x, y, width, height);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = palette.cmd;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  // Half-pixel offset, like the extent hairline: without it a 1 px stroke lands
  // across two device rows and reads as a grey smear rather than a line.
  ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(width), Math.round(height));
  ctx.restore();
}

/**
 * The robot where it stands: its footprint, pointed at its heading.
 *
 * A body, not a ring-and-arrow, so it never reads as a vertex even while
 * parked on one (often the reason the screen is open). The nose is part of
 * the outline because at a dozen pixels a detached arrowhead reads as a
 * second object.
 */
export function drawRobot(
  ctx: CanvasRenderingContext2D,
  view: View,
  meta: MapMetadata,
  pose: PlanarPose,
  palette: Palette,
): void {
  const at = vertexScreen(view, meta, pose.x, pose.y);
  // px per metre: cells per metre from the map, screen px per cell from the view.
  const pxPerM = view.scale / meta.resolution;
  const length = Math.max(ROBOT_LENGTH_M * pxPerM, MIN_ROBOT_LENGTH_PX);
  const width = length * (ROBOT_WIDTH_M / ROBOT_LENGTH_M);
  const halfLength = length / 2;
  const halfWidth = width / 2;

  ctx.save();
  ctx.translate(at.cx, at.cy);
  // Negated: the pose is CCW from +x in the map frame and screen y grows downward,
  // the same flip worldToGrid does for position.
  ctx.rotate(-(pose.theta * Math.PI) / 180);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.setLineDash([]);

  // A rectangle along +x (the heading) with its front pulled to a nose; the nose
  // takes a fifth of the length so the body still reads as a rectangle.
  const nose = halfLength * 0.4;
  const body = new Path2D();
  body.moveTo(halfLength, 0);
  body.lineTo(halfLength - nose, -halfWidth);
  body.lineTo(-halfLength, -halfWidth);
  body.lineTo(-halfLength, halfWidth);
  body.lineTo(halfLength - nose, halfWidth);
  body.closePath();

  ctx.strokeStyle = MARKER_HALO;
  ctx.lineWidth = 3.5;
  ctx.stroke(body);

  // A wash, not a fill: the obstacle it is parked against must show through.
  ctx.fillStyle = palette.live;
  ctx.globalAlpha = 0.22;
  ctx.fill(body);
  ctx.globalAlpha = 1;

  ctx.strokeStyle = palette.live;
  ctx.lineWidth = 1.5;
  ctx.stroke(body);

  ctx.restore();
}

/** A zone's corners as a closed screen-space path, via the one view transform. */
function zonePath(view: View, meta: MapMetadata, points: readonly ZonePoint[]): Path2D {
  const path = new Path2D();
  points.forEach((point, index) => {
    const at = vertexScreen(view, meta, point.x, point.y);
    if (index === 0) path.moveTo(at.cx, at.cy);
    else path.lineTo(at.cx, at.cy);
  });
  path.closePath();
  return path;
}

/**
 * The finished forbidden zones: halo, wash, edge, like the robot footprint,
 * so the doorway being fenced off shows through. A selected zone is heavier,
 * not a second hue, and drawn last so its edge is never under a neighbour's.
 *
 * Corner handles show only where a press would do something: on every zone
 * while Shape is armed with nothing anchored, on the zone a shape is anchored
 * to (its other corners filled once a merge is possible), and on selected
 * zones. A hovered or dragged handle swells, and a dragged corner is drawn
 * where the pointer has it.
 */
export function drawZones(
  ctx: CanvasRenderingContext2D,
  view: View,
  meta: MapMetadata,
  gesture: Gesture | null,
  hoverCorner: ZoneCornerRef | null,
  props: DrawState,
  palette: Palette,
): void {
  const { zones, selectedZoneIds, zoneDraftAnchor: anchor } = props;
  if (zones.length === 0) return;
  const isSelected = (zone: ZonePolygon) => selectedZoneIds.includes(zone.id);
  const dragging = gesture?.kind === "point" && gesture.corner?.zoneId ? gesture.corner : null;
  const held = dragging ?? (hoverCorner?.zoneId ? hoverCorner : null);
  const armed = props.mode === "zone" && props.zoneTool === "shape" && !props.spacePan;
  const canMerge = anchor !== null && props.zoneDraft.length >= 2;

  ctx.save();
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  const ordered = selectedZoneIds.length
    ? [...zones.filter((zone) => !isSelected(zone)), ...zones.filter(isSelected)]
    : zones;
  for (const zone of ordered) {
    const selected = isSelected(zone);
    const points =
      dragging && dragging.zoneId === zone.id
        ? zone.points.map((point, index) => (index === dragging.index ? dragging.at : point))
        : zone.points;
    const path = zonePath(view, meta, points);
    ctx.strokeStyle = MARKER_HALO;
    ctx.lineWidth = selected ? 5 : 3.5;
    ctx.stroke(path);
    ctx.fillStyle = palette.warn;
    ctx.globalAlpha = selected ? 0.38 : 0.22;
    ctx.fill(path);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = palette.warn;
    ctx.lineWidth = selected ? 3 : 1.5;
    ctx.stroke(path);

    const anchoredHere = anchor !== null && anchor.zoneId === zone.id;
    if (!selected && !(armed && anchor === null) && !anchoredHere) continue;
    points.forEach((point, index) => {
      const { cx, cy } = vertexScreen(view, meta, point.x, point.y);
      const swell = held && held.zoneId === zone.id && held.index === index ? 2.5 : 0;
      const target = anchoredHere && canMerge && index !== anchor.index;
      ctx.beginPath();
      ctx.arc(cx, cy, VERTEX_DOT_RADIUS + (target ? 1.5 : 0) + swell, 0, Math.PI * 2);
      ctx.fillStyle = MARKER_HALO;
      ctx.fill();
      ctx.strokeStyle = palette.warn;
      ctx.lineWidth = target ? 2.5 : 1.5;
      ctx.stroke();
      if (target) {
        ctx.fillStyle = palette.warn;
        ctx.fill();
      }
    });
  }
  ctx.restore();
}

/**
 * The shape in flight: corners, edges, and a rubber edge to the pointer.
 * Dashed `cmd` like the draft marker; red is for zones that already forbid.
 *
 * The first corner is emphasised exactly when pressing it closes the shape
 * (classifyZonePress) — the operator's only cue that it can close. A hovered
 * or dragged corner swells. `hoverCorner` hit-tests the pointer, not
 * `hover`'s cell, because at high zoom a cell is wider than the dot's slop.
 */
export function drawZoneDraft(
  ctx: CanvasRenderingContext2D,
  view: View,
  meta: MapMetadata,
  gesture: Gesture | null,
  hover: CellProbe | null,
  hoverCorner: ZoneCornerRef | null,
  props: DrawState,
  palette: Palette,
): void {
  if (props.zoneDraft.length === 0) return;
  // A dragged corner is drawn at the pointer: the shell hears of the move on
  // release. Only the draft's own (zoneId null); zone handles are drawZones's.
  const dragging =
    gesture?.kind === "point" && gesture.corner && gesture.corner.zoneId === null
      ? gesture.corner
      : null;
  const hovered = hoverCorner && hoverCorner.zoneId === null ? hoverCorner.index : null;
  const corners = dragging
    ? props.zoneDraft.map((point, index) => (index === dragging.index ? dragging.at : point))
    : props.zoneDraft;
  const at = corners.map((point) => vertexScreen(view, meta, point.x, point.y));

  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  // The rubber edge follows the hovered cell, but not mid-pan or mid-drag, nor
  // over the draft's own corner (a click there adds nothing). Over a finished
  // zone's handle it snaps to the handle, where a click would attach or end it.
  const armed = props.mode === "zone" && props.zoneTool === "shape" && !props.spacePan;
  const busy = gesture?.kind === "pan" || gesture?.kind === "point";
  const handle =
    hoverCorner && hoverCorner.zoneId !== null
      ? props.zones.find((zone) => zone.id === hoverCorner.zoneId)?.points[hoverCorner.index]
      : null;
  let head: { cx: number; cy: number } | null = null;
  if (armed && !busy) {
    if (handle) head = vertexScreen(view, meta, handle.x, handle.y);
    else if (hover && hovered === null) head = gridToScreen(view, hover.col + 0.5, hover.row + 0.5);
  }

  const edges = new Path2D();
  at.forEach(({ cx, cy }, index) => {
    if (index === 0) edges.moveTo(cx, cy);
    else edges.lineTo(cx, cy);
  });
  if (head) edges.lineTo(head.cx, head.cy);

  ctx.strokeStyle = MARKER_HALO;
  ctx.lineWidth = 3.5;
  ctx.stroke(edges);
  ctx.strokeStyle = palette.cmd;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke(edges);
  ctx.setLineDash([]);

  // An anchored shape's first corner is the zone's, and never what closes it.
  const closable = props.zoneDraftAnchor === null && canCloseZone(corners);
  const held = dragging ? dragging.index : armed && !busy ? hovered : null;
  at.forEach(({ cx, cy }, index) => {
    const emphasis = index === 0 && closable;
    const swell = index === held ? 2.5 : 0;
    ctx.beginPath();
    ctx.arc(cx, cy, (emphasis ? VERTEX_DOT_RADIUS + 1.5 : VERTEX_DOT_RADIUS) + swell, 0, Math.PI * 2);
    ctx.fillStyle = MARKER_HALO;
    ctx.fill();
    ctx.strokeStyle = palette.cmd;
    ctx.lineWidth = emphasis ? 2.5 : 1.5;
    ctx.stroke();
    if (emphasis) {
      ctx.fillStyle = palette.cmd;
      ctx.fill();
    }
  });

  ctx.restore();
}

export interface MarkerSpec {
  cx: number;
  cy: number;
  /** Degrees, CCW from +x in the map frame. */
  theta: number;
  colour: string;
  /** Thicker ring and a filled centre — the selected or in-flight vertex. */
  emphasis: boolean;
  glyph: string | null;
  label: string | null;
  dashed: boolean;
}

/** One marker: a ring, a heading arrow, and a `G · name` caption, each over a MARKER_HALO stroke. */
export function drawMarker(ctx: CanvasRenderingContext2D, spec: MarkerSpec): void {
  const { cx, cy, colour, emphasis, dashed } = spec;
  const radians = (spec.theta * Math.PI) / 180;
  // Screen y grows downward, map y grows upward — the same flip worldToGrid does.
  const tipX = cx + Math.cos(radians) * VERTEX_ARROW_PX;
  const tipY = cy - Math.sin(radians) * VERTEX_ARROW_PX;

  const shape = new Path2D();
  shape.moveTo(cx + VERTEX_DOT_RADIUS, cy);
  shape.arc(cx, cy, VERTEX_DOT_RADIUS, 0, Math.PI * 2);
  const arrow = new Path2D();
  arrow.moveTo(cx, cy);
  arrow.lineTo(tipX, tipY);
  // Two barbs at ±150° off the heading, so the head reads as an arrow at 18 px.
  for (const offset of [Math.PI * 0.83, -Math.PI * 0.83]) {
    arrow.moveTo(tipX, tipY);
    arrow.lineTo(
      tipX + Math.cos(radians + offset) * 6,
      tipY - Math.sin(radians + offset) * 6,
    );
  }

  const width = emphasis ? 2 : 1.5;

  ctx.setLineDash([]);
  ctx.strokeStyle = MARKER_HALO;
  ctx.lineWidth = width + 2;
  ctx.stroke(shape);
  ctx.stroke(arrow);

  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  if (dashed) ctx.setLineDash([3, 2]);
  ctx.stroke(shape);
  ctx.setLineDash([]);
  ctx.stroke(arrow);

  if (emphasis && !dashed) {
    ctx.fillStyle = colour;
    ctx.fill(shape);
  }

  const caption = [spec.glyph, spec.label].filter(Boolean).join(" · ");
  if (!caption) return;

  // Offset up-right of the dot so the caption never sits under the arrow when
  // the heading points right, which is the default for a click without a drag.
  const tx = cx + VERTEX_DOT_RADIUS + 4;
  const ty = cy - VERTEX_DOT_RADIUS - 4;
  ctx.font = "500 11px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.lineWidth = 3;
  ctx.strokeStyle = MARKER_HALO;
  ctx.strokeText(caption, tx, ty);
  ctx.fillStyle = colour;
  ctx.fillText(caption, tx, ty);
}
