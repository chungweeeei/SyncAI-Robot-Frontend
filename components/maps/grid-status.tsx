"use client";

import { Readout, overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import { gridToWorld } from "@/lib/map/view";
import type { CellProbe } from "@/lib/map/editor";
import type { MapMetadata } from "@/lib/types/robot";

export interface GridStatusProps {
  meta: MapMetadata;
  hover: CellProbe | null;
  className?: string;
}

/**
 * Where the pointer is: the cell under it, and that cell's place on the map.
 *
 * Two readouts, by request. The value under the pointer, the zoom and the
 * per-value cell counts it used to carry went: the floor plan shows a cell's
 * value by its grey, and the zoom is what the view looks like.
 */
export function GridStatus({ meta, hover, className }: GridStatusProps) {
  // Cell centres, not corners. gridToWorld(col, row) is the cell's corner, and at
  // 0.05 m/cell reporting that as "the position" is a 2.5 cm lie in a readout an
  // operator may be using to check where a wall actually is.
  const world = hover ? gridToWorld(hover.col + 0.5, hover.row + 0.5, meta) : null;

  return (
    <div className={cn(overlayPanel, "w-52 space-y-1.5 p-2.5", className)}>
      <Readout label="Cell" value={hover ? `${hover.col}, ${hover.row}` : "—"} />
      <Readout
        label="Map"
        value={world ? `${world.wx.toFixed(2)}, ${world.wy.toFixed(2)}` : "—"}
        unit={world ? "m" : undefined}
      />
    </div>
  );
}
