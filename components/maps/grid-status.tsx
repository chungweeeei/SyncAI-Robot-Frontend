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
 * Where the pointer is: the cell under it, and its place on the map. Two
 * readouts, by request — the grey and the view already show value and zoom.
 */
export function GridStatus({ meta, hover, className }: GridStatusProps) {
  // Cell centres, not corners: at 0.05 m/cell a corner is a 2.5 cm lie to an
  // operator checking where a wall is.
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
