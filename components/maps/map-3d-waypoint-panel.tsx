"use client";

import { Trash2Icon } from "lucide-react";

import { Chip, overlayPanel } from "@/components/console/instrument";
import { VertexList } from "@/components/maps/vertex-panel";
import { cn } from "@/lib/utils";
import type { MapVertex } from "@/lib/types/map";

/**
 * The 3D view's waypoint list: every name on the map, so an operator naming
 * the next stop can see which names are taken, and the set a Delete takes.
 *
 * A row toggles its stop in the selection rather than narrowing to it, as
 * the Select tool does on the map: the floor plan's form has no place here,
 * since a tap on a marker already opens the stop. Every floor's stops are
 * listed, the hidden ones too, so the list answers "is this name taken" for
 * the whole map.
 */
export function Map3dWaypointPanel({
  vertices,
  selectedIds,
  pendingIds,
  lockReason,
  onToggle,
  onClear,
  onDelete,
  className,
}: {
  vertices: MapVertex[];
  selectedIds: readonly string[];
  /** Rows Save would write, marked with the toolbar Save's caution dot. */
  pendingIds: ReadonlySet<string>;
  /** Why no waypoint may be deleted (a job, or the list unread), or null. */
  lockReason: string | null;
  onToggle: (id: string) => void;
  onClear: () => void;
  /** Stage the deletion of every selected stop; the caller asks first. */
  onDelete: () => void;
  className?: string;
}) {
  const count = selectedIds.length;

  return (
    <div className={cn(overlayPanel, "flex flex-col gap-2 p-2.5", className)}>
      <div className="flex h-4 items-center justify-between gap-2">
        <span className="instrument-label text-muted-foreground">Waypoints</span>
        <Chip tone={vertices.length ? "neutral" : "caution"}>{vertices.length}</Chip>
      </div>

      {vertices.length === 0 ? (
        <p className="text-[11px] leading-tight text-muted-foreground">
          No waypoints on this map yet.
        </p>
      ) : (
        <VertexList
          vertices={vertices}
          selectedIds={selectedIds}
          pendingIds={pendingIds}
          onSelect={onToggle}
          empty={null}
        />
      )}

      {count > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-hairline pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="instrument-label text-signal-cmd">{count} selected</span>
            <button
              type="button"
              onClick={onClear}
              className="instrument-label rounded-sm border border-hairline px-1.5 py-0.5 text-muted-foreground transition-colors pointer-coarse:min-h-10 hover:bg-elevated hover:text-foreground"
            >
              Clear
            </button>
          </div>
          <button
            type="button"
            disabled={lockReason !== null}
            title={lockReason ?? undefined}
            onClick={onDelete}
            className="instrument-label flex h-7 items-center justify-center gap-1.5 rounded-sm border border-signal-warn/50 text-signal-warn transition-colors pointer-coarse:min-h-10 hover:bg-signal-warn/12 disabled:opacity-50"
          >
            <Trash2Icon className="size-3.5" aria-hidden />
            Delete {count}
          </button>
        </div>
      )}
    </div>
  );
}
