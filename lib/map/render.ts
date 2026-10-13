// Grid bytes to pixels; the only lib/map/ file that touches the DOM.
//
// The mirror is a detached canvas holding the grid 1:1 — a *mirror*, never a
// source: the Uint8Array is the truth and nothing calls getImageData, so colour
// management and premultiplication never touch the data. A plain <canvas>, not
// OffscreenCanvas, which buys nothing without a worker (and COOP/COEP headers).

import type { CellRect, MapGrid } from "@/lib/map/grid";

export interface GridMirror {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
}

export function createGridMirror(grid: MapGrid): GridMirror {
  const canvas = document.createElement("canvas");
  canvas.width = grid.width;
  canvas.height = grid.height;
  // alpha: false — every pixel written here is opaque, and it lets the compositor
  // skip a blend on every drawImage.
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("2D canvas context unavailable");
  return { canvas, ctx };
}

/**
 * Copy a rectangle of grid bytes into the mirror as literal greyscale
 * (`r = g = b = byte`, no theme), so the shade on screen is the byte the file
 * gets. Only the chrome drawn over it follows the theme.
 *
 * A fresh ImageData per call on purpose: a pooled tile saves nothing
 * measurable and adds a stale-region failure mode.
 */
export function blitGridRect(
  mirror: GridMirror,
  grid: MapGrid,
  rect: CellRect,
): void {
  const col = Math.max(rect.col, 0);
  const row = Math.max(rect.row, 0);
  const w = Math.min(rect.w, grid.width - col);
  const h = Math.min(rect.h, grid.height - row);
  if (w <= 0 || h <= 0) return;

  const image = mirror.ctx.createImageData(w, h);
  const out = image.data;
  const { data, width } = grid;

  let o = 0;
  for (let r = 0; r < h; r += 1) {
    let i = (row + r) * width + col;
    for (let c = 0; c < w; c += 1, i += 1, o += 4) {
      const byte = data[i];
      out[o] = byte;
      out[o + 1] = byte;
      out[o + 2] = byte;
      out[o + 3] = 255;
    }
  }

  mirror.ctx.putImageData(image, col, row);
}

/** Blit the whole grid. Used once on load and after an undo of a huge patch. */
export function blitGrid(mirror: GridMirror, grid: MapGrid): void {
  blitGridRect(mirror, grid, { col: 0, row: 0, w: grid.width, h: grid.height });
}

/** Release the up-to-9.6 MB backing store now; it can outlive the element's last reference. */
export function disposeGridMirror(mirror: GridMirror): void {
  mirror.canvas.width = 0;
  mirror.canvas.height = 0;
}
