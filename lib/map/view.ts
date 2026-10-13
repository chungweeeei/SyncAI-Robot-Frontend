// The editor's view transform, and the grid <-> world transforms.
//
// There is exactly one transform: draw() and every pointer handler go through
// these functions rather than deriving their own scale/offset. Everything is in
// CSS px (what `event.clientX` gives); device pixel ratio belongs only in the
// canvas's `setTransform`, or every hit test breaks.

import type { GridSize } from "@/lib/map/grid";
import type { MapMetadata } from "@/lib/types/robot";

/** Uniform scale plus the grid origin's offset inside the viewport, in CSS px. */
export interface View {
  scale: number;
  ox: number;
  oy: number;
}

export interface Size {
  width: number;
  height: number;
}

/** One cell = 32 CSS px. Enough to click a single 5 cm cell without hunting. */
export const MAX_SCALE = 32;

/** Cell gridlines appear at and above this scale; below it they are noise. */
export const CELL_GRID_MIN_SCALE = 8;

/**
 * ROS world coordinates -> grid pixel coordinates (y flipped: canvas rows
 * grow downward while the ROS grid's row 0 sits at the map origin).
 */
export function worldToGrid(wx: number, wy: number, meta: MapMetadata) {
  return {
    px: (wx - meta.origin[0]) / meta.resolution,
    py: meta.height - (wy - meta.origin[1]) / meta.resolution,
  };
}

/** Inverse of worldToGrid; turns a cell back into a pose in the map frame. */
export function gridToWorld(px: number, py: number, meta: MapMetadata) {
  return {
    wx: px * meta.resolution + meta.origin[0],
    wy: (meta.height - py) * meta.resolution + meta.origin[1],
  };
}

/** The scale at which the whole grid just fits the viewport. */
export function fitScale(rect: Size, size: GridSize): number {
  return Math.min(rect.width / size.width, rect.height / size.height);
}

/** Uniformly scaled and centred — the view the editor opens at. */
export function fitView(rect: Size, size: GridSize): View {
  const scale = fitScale(rect, size);
  return {
    scale,
    ox: (rect.width - size.width * scale) / 2,
    oy: (rect.height - size.height * scale) / 2,
  };
}

export function screenToGrid(view: View, cx: number, cy: number) {
  return { px: (cx - view.ox) / view.scale, py: (cy - view.oy) / view.scale };
}

export function gridToScreen(view: View, px: number, py: number) {
  return { cx: px * view.scale + view.ox, cy: py * view.scale + view.oy };
}

/** The cell under a container-local point, or null outside the grid. */
export function cellAt(view: View, size: GridSize, cx: number, cy: number) {
  const { px, py } = screenToGrid(view, cx, cy);
  const col = Math.floor(px);
  const row = Math.floor(py);
  if (col < 0 || col >= size.width || row < 0 || row >= size.height) return null;
  return { col, row };
}

/**
 * Keep the map reachable, not pinned: it must still straddle the viewport
 * centre on both axes, so it can never be flung off screen yet pans at every
 * zoom.
 *
 * Not a "never pass the viewport edge, centre an axis that fits" rule: at the
 * opening fit view that centred both axes and made Pan a no-op. So this never
 * re-centres; `fitView` (the Fit button) is the explicit way back.
 */
export function clampView(view: View, rect: Size, size: GridSize): View {
  return {
    scale: view.scale,
    ox: clampAxis(view.ox, rect.width, size.width * view.scale),
    oy: clampAxis(view.oy, rect.height, size.height * view.scale),
  };
}

/**
 * One axis of the straddle rule: neither map edge may cross the viewport's
 * midpoint. `extent` is the scaled map length, so travel is never zero.
 */
function clampAxis(offset: number, viewport: number, extent: number): number {
  const mid = viewport / 2;
  return Math.min(mid, Math.max(mid - extent, offset));
}

/**
 * Zoom by `factor` about a container-local point, holding the grid position
 * under it.
 *
 * Floored at fitScale, which also caps downscaling at ~2x, the range filtered
 * `drawImage` handles without losing 1-cell walls (see grid-canvas.tsx).
 * `minScale` lets a surface whose opening view is smaller than the bare fit
 * (the task editor's inset preview) keep it, rather than snap to the bare fit
 * on the first wheel notch.
 */
export function zoomAt(
  view: View,
  cx: number,
  cy: number,
  factor: number,
  rect: Size,
  size: GridSize,
  minScale: number = fitScale(rect, size),
): View {
  const scale = Math.min(Math.max(view.scale * factor, minScale), MAX_SCALE);
  const ratio = scale / view.scale;
  return clampView(
    { scale, ox: cx - (cx - view.ox) * ratio, oy: cy - (cy - view.oy) * ratio },
    rect,
    size,
  );
}

export function panBy(view: View, dx: number, dy: number, rect: Size, size: GridSize): View {
  return clampView({ scale: view.scale, ox: view.ox + dx, oy: view.oy + dy }, rect, size);
}

/**
 * Bring one grid point (e.g. the robot) to the viewport centre. Exact for any
 * point inside the map. The zoom is kept, not refit: the operator zoomed in
 * for a reason.
 */
export function centerView(
  view: View,
  px: number,
  py: number,
  rect: Size,
  size: GridSize,
): View {
  return clampView(
    {
      scale: view.scale,
      ox: rect.width / 2 - px * view.scale,
      oy: rect.height / 2 - py * view.scale,
    },
    rect,
    size,
  );
}

/**
 * Re-clamp a view for a new viewport size, holding the grid point at the old
 * centre. Not a refit, so a resize never throws away the operator's zoom.
 */
export function reanchorView(
  view: View,
  from: Size,
  to: Size,
  size: GridSize,
  minScale: number = fitScale(to, size),
): View {
  const centre = screenToGrid(view, from.width / 2, from.height / 2);
  const scale = Math.min(Math.max(view.scale, minScale), MAX_SCALE);
  return clampView(
    {
      scale,
      ox: to.width / 2 - centre.px * scale,
      oy: to.height / 2 - centre.py * scale,
    },
    to,
    size,
  );
}
