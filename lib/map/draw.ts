// Waypoint markers drawn on a 2D canvas over a 3D view: `(ctx, …) -> void`,
// no React. The task editor's route map lays them over its 3D map
// (components/tasks/route-canvas-3d.tsx, via lib/map/preview.ts). Signal hues
// come from lib/theme/signal.ts; only the hue these marks add is written out
// below.

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
}

/** One marker: a ring, a heading arrow, and a `G · name` caption, each over a MARKER_HALO stroke. */
export function drawMarker(ctx: CanvasRenderingContext2D, spec: MarkerSpec): void {
  const { cx, cy, colour, emphasis, dashed } = spec;
  const radians = (spec.theta * Math.PI) / 180;
  // Screen y grows downward, map y grows upward.
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
