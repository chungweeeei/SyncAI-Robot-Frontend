// Everything mutable that one loaded map owns. Passed by reference and never
// React state: immutability would cost a full 2.4 MB copy per stroke.
//
// `repaint` is deliberate: undo lives in the editor shell but must reach the
// mirror and frame scheduler only GridCanvas knows, so the canvas installs it on
// mount and clears it on cleanup — simpler than a useImperativeHandle ref.

import type { CellRect, MapGrid } from "@/lib/map/grid";
import type { MapMetadata } from "@/lib/types/robot";
import {
  createGridMirror,
  disposeGridMirror,
  blitGrid,
  type GridMirror,
} from "@/lib/map/render";
import { StrokeAccumulator } from "@/lib/map/patch";

/**
 * Distinguishes two sessions for one map (every strict-mode double mount). The
 * editor keys on it, so the undo history resets by remounting, not in an effect.
 */
let nextSessionId = 1;

export interface GridSession {
  id: number;
  name: string;
  /** Resolution / origin / extent, for the world-coordinate readout. */
  meta: MapMetadata;
  grid: MapGrid;
  mirror: GridMirror;
  /** Scratch for the stroke accumulator; allocated once per session. */
  accumulator: StrokeAccumulator;
  /** Installed by GridCanvas. Pass a rect to repaint part of the mirror. */
  repaint: ((dirty?: CellRect) => void) | null;
}

export function createGridSession(
  name: string,
  meta: MapMetadata,
  grid: MapGrid,
): GridSession {
  const mirror = createGridMirror(grid);
  blitGrid(mirror, grid);
  nextSessionId += 1;
  return {
    id: nextSessionId,
    name,
    meta,
    grid,
    mirror,
    accumulator: new StrokeAccumulator(grid, new Uint8Array(grid.width * grid.height)),
    repaint: null,
  };
}

export function disposeGridSession(session: GridSession): void {
  session.repaint = null;
  disposeGridMirror(session.mirror);
}
