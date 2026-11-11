// Waypoint markers drawn on a 2D canvas over a 3D view: `(ctx, …) -> void`,
// no React. The task editor's route map lays them over its 3D map
// (components/tasks/route-canvas-3d.tsx, via lib/map/preview.ts). Signal hues
// come from lib/theme/signal.ts; only the hue these marks add is written out
// below.

import {
  CHARGER_ICON_PATH,
  CHARGER_MARK_BOLT,
  CHARGER_MARK_FILL,
} from "@/lib/map/vertex";
import { SIGNAL, cssHex } from "@/lib/theme/signal";

export interface Palette {
  /** A commanded value the operator set: the job's stops and its route. */
  cmd: string;
  /**
   * Stored waypoints. Not a signal hue: a saved waypoint is neither
   * measured, commanded nor faulted.
   */
  vertex: string;
}

export const PALETTES: Record<"light" | "dark", Palette> = {
  light: {
    cmd: cssHex(SIGNAL.light.cmd),
    vertex: "#2f4a58",
  },
  dark: {
    cmd: cssHex(SIGNAL.dark.cmd),
    vertex: "#a8bcc7",
  },
};

/**
 * Stroked under every mark before its colour. The 3D map beneath is shaded by
 * height, so no single hue is legible over all of it; the halo is what makes a
 * mark readable anywhere.
 */
export const MARKER_HALO = "rgba(255, 255, 255, 0.85)";

/*
 * Markers are CSS pixels and do NOT scale with zoom: a waypoint is a pose
 * with no size, and scaling it would make it vanish zoomed out, where the
 * operator is most likely looking for it.
 */
export const VERTEX_DOT_RADIUS = 4.5;
export const VERTEX_ARROW_PX = 18;

/**
 * A charger's mark: a filled rounded square with the bolt in it, where a stop
 * is a 4.5 px dot. Bigger, since a bolt narrower than this is a smudge; still
 * inside the click slop, so it is hit where it is drawn.
 */
export const CHARGER_MARK_HALF_PX = 7;

/** Click slop around a marker centre. */
export const VERTEX_HIT_RADIUS = 11;
/** Under a finger, which covers ~22 px and can't see the dot. */
export const VERTEX_HIT_RADIUS_TOUCH = 22;

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
  /** A charger: the square and bolt instead of the dot (CHARGER_MARK_HALF_PX). */
  charger?: boolean;
}

/** One marker: a ring, a heading arrow, and a `G · name` caption, each over a MARKER_HALO stroke. */
export function drawMarker(ctx: CanvasRenderingContext2D, spec: MarkerSpec): void {
  const { cx, cy, emphasis, dashed } = spec;
  const charger = spec.charger ?? false;
  // A charger at rest is black (CHARGER_MARK_FILL); one the job goes to takes
  // the job's hue like any stop, so the route still reads as one colour.
  const colour = charger && !emphasis ? CHARGER_MARK_FILL : spec.colour;
  const radians = (spec.theta * Math.PI) / 180;
  // Screen y grows downward, map y grows upward.
  const tipX = cx + Math.cos(radians) * VERTEX_ARROW_PX;
  const tipY = cy - Math.sin(radians) * VERTEX_ARROW_PX;

  const shape = new Path2D();
  if (charger) {
    const half = CHARGER_MARK_HALF_PX;
    shape.roundRect(cx - half, cy - half, half * 2, half * 2, 3);
  } else {
    shape.moveTo(cx + VERTEX_DOT_RADIUS, cy);
    shape.arc(cx, cy, VERTEX_DOT_RADIUS, 0, Math.PI * 2);
  }
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

  // A charger is always filled: the bolt is drawn light on its colour.
  if ((emphasis || charger) && !dashed) {
    ctx.fillStyle = colour;
    ctx.fill(shape);
  }
  if (charger) {
    // The icon's 24-unit grid fitted to the square, a pixel in from its edge.
    const size = CHARGER_MARK_HALF_PX * 2 - 2;
    ctx.save();
    ctx.translate(cx - size / 2, cy - size / 2);
    ctx.scale(size / 24, size / 24);
    ctx.fillStyle = CHARGER_MARK_BOLT;
    ctx.fill(new Path2D(CHARGER_ICON_PATH));
    ctx.restore();
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
