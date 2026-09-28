"use client";

import { Readout, overlayPanel, type Tone } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import { FREE, OCCUPIED, classify } from "@/lib/map/grid";
import { gridToWorld } from "@/lib/map/view";
import type { CellProbe } from "@/lib/map/editor";
import type { MapMetadata } from "@/lib/types/robot";

const VALUE_LABEL: Record<number, string> = {
  [OCCUPIED]: "Wall",
  [FREE]: "Floor",
};

/**
 * Tone by what the value *is*, per the console's signal semantics: an obstacle is a
 * faulted-for-navigation cell, unknown is degraded, free is a good measurement.
 */
const VALUE_TONE: Record<number, Tone> = {
  [OCCUPIED]: "warn",
  [FREE]: "live",
};

export interface GridStatusProps {
  meta: MapMetadata;
  hover: CellProbe | null;
  scale: number;
  className?: string;
}

export function GridStatus({ meta, hover, scale, className }: GridStatusProps) {
  // Cell centres, not corners. gridToWorld(col, row) is the cell's corner, and at
  // 0.05 m/cell reporting that as "the position" is a 2.5 cm lie in a readout an
  // operator may be using to check where a wall actually is.
  const world = hover ? gridToWorld(hover.col + 0.5, hover.row + 0.5, meta) : null;
  const value = hover ? classify(hover.byte) : null;

  return (
    <div className={cn(overlayPanel, "w-52 p-2.5", className)}>
      <div className="space-y-1.5">
        <Readout
          label="Cell"
          value={hover ? `${hover.col}, ${hover.row}` : "—"}
        />
        <Readout
          label="Map"
          value={world ? `${world.wx.toFixed(2)}, ${world.wy.toFixed(2)}` : "—"}
          unit={world ? "m" : undefined}
        />
        <Readout
          label="Value"
          value={value === null ? "—" : (VALUE_LABEL[value] ?? "Unknown")}
          tone={value === null ? "neutral" : (VALUE_TONE[value] ?? "caution")}
        />
        <Readout label="Zoom" value={Math.round(scale * 100)} unit="%" />
      </div>
      {/* No per-value cell counts any more, by request: the totals were a
        * census nobody edited by, and the readout is about the cell under the
        * pointer. */}
    </div>
  );
}
