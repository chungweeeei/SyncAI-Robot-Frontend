// The ground editor's 2D drawing: the column raster and the brush ring. No
// React, like lib/map/draw.ts, whose palette and cell grid it shares.

import { PALETTES, type Palette } from "@/lib/map/draw";
import {
  NO_FLOOR,
  type Band,
  type ColumnFloors,
  type GroundEdits,
  cellOf,
} from "@/lib/map/ground-fill";
import { gridToScreen, type View } from "@/lib/map/view";
import { rampColor } from "@/lib/theme/height-ramp";
import { SIGNAL, cssHex } from "@/lib/theme/signal";

/**
 * The patch hue, both themes: `signal-cmd`, a value the operator is
 * committing, the same as the brush ring. Alpha-free: the raster is blitted
 * over the well, and a patch must read as solid floor.
 */
const PATCH_RGB: Record<"light" | "dark", [number, number, number]> = {
  light: hexToRgb(SIGNAL.light.cmd),
  dark: hexToRgb(SIGNAL.dark.cmd),
};

function hexToRgb(color: number): [number, number, number] {
  return [(color >> 16) & 0xff, (color >> 8) & 0xff, color & 0xff];
}

/** `signal-warn` as a CSS colour, for the erase ring. */
export function eraseRingColor(theme: "light" | "dark"): string {
  return cssHex(SIGNAL[theme].warn);
}

/** What one raster cell is painted as; the editor's legend reads the same table. */
export type ColumnKind = "patch" | "floor" | "none";

/**
 * Paint every column into `image` (the raster, one pixel a column): the
 * floor by height on the shared ramp over the band, a patch in the command
 * hue, and nothing where there is no floor in the band — transparent, so
 * the well shows through and a hole reads as a hole.
 */
export function paintColumns(
  image: ImageData,
  floors: ColumnFloors,
  edits: GroundEdits,
  band: Band,
  theme: "light" | "dark",
): void {
  for (let index = 0; index < floors.floor.length; index += 1) {
    paintColumn(image, floors, edits, band, theme, index);
  }
}

/** Repaint one column after a dab or an undo. */
export function paintColumn(
  image: ImageData,
  floors: ColumnFloors,
  edits: GroundEdits,
  band: Band,
  theme: "light" | "dark",
  index: number,
): void {
  const { col, row } = cellOf(floors, index);
  const at = (row * floors.width + col) * 4;
  const out = image.data;
  const patched = edits.get(index);
  if (patched !== undefined) {
    const [r, g, b] = PATCH_RGB[theme];
    out[at] = r;
    out[at + 1] = g;
    out[at + 2] = b;
    out[at + 3] = 255;
    return;
  }
  const f = floors.floor[index];
  if (f === NO_FLOOR) {
    out[at + 3] = 0;
    return;
  }
  const span = band.hi > band.lo ? band.hi - band.lo : 1;
  const rgb = rampColor((f - band.lo) / span, [0, 0, 0]);
  out[at] = Math.round(rgb[0] * 255);
  out[at + 1] = Math.round(rgb[1] * 255);
  out[at + 2] = Math.round(rgb[2] * 255);
  out[at + 3] = 255;
}

/**
 * The brush as a circle of `radius` cells about the hovered cell's centre,
 * scaled with the view so it shows what a press fills; never smaller than
 * the floor plan editor's ring. The erase ring is the warn hue, the fill
 * ring the command hue.
 */
export function drawGroundBrush(
  ctx: CanvasRenderingContext2D,
  view: View,
  cell: { col: number; row: number },
  radius: number,
  color: string,
): void {
  const { cx, cy } = gridToScreen(view, cell.col + 0.5, cell.row + 0.5);
  const r = Math.max((radius + 0.5) * view.scale, 3);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

export { PALETTES, type Palette };
