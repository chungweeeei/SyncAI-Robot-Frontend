"use client";

import * as React from "react";
import { SearchIcon, Trash2Icon } from "lucide-react";

import { Chip, overlayPanel } from "@/components/console/instrument";
import { Input } from "@/components/ui/input";
import { vertexGlyph } from "@/lib/map/vertex";
import { cn } from "@/lib/utils";
import type { MapVertex } from "@/lib/types/map";

/**
 * The 3D view's waypoint list: every name on the map, so an operator naming
 * the next stop can see which names are taken, and the set a Delete takes.
 *
 * A row toggles its stop in the selection, as the Select tool does on the
 * map; a tap on a marker already opens the stop. Every floor's stops are
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

/** The list itself: every waypoint, filterable by name, a row toggling its stop. */
function VertexList({
  vertices,
  selectedIds,
  pendingIds,
  onSelect,
  empty,
}: {
  vertices: MapVertex[];
  /** Every highlighted row, so a band lights all of its members here too. */
  selectedIds: readonly string[];
  /** Rows Save would write, marked with the toolbar Save's caution dot. */
  pendingIds: ReadonlySet<string>;
  /** A row picked: it toggles that stop in the selection. */
  onSelect: (id: string) => void;
  empty: string | null;
}) {
  const [filter, setFilter] = React.useState("");
  if (!vertices.length) {
    return empty ? (
      <p className="text-[11px] leading-tight text-muted-foreground">{empty}</p>
    ) : null;
  }

  // By name, case-folded: typing "Dock" should find "dock-a".
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? vertices.filter((vertex) => vertex.name.toLowerCase().includes(needle))
    : vertices;

  return (
    <div className="border-t border-hairline pt-1.5">
      <div className="relative mb-1">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-1.5 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="Filter waypoints"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter by name"
          className="h-7 rounded-sm pl-6 md:text-[12px]"
        />
      </div>
      {shown.length === 0 ? (
        <p className="px-1 py-0.5 text-[11px] leading-tight text-muted-foreground">
          No waypoint matches.
        </p>
      ) : (
        // Five rows, by request, then its own scroll so a long list can't grow
        // the panel past the viewport. 114 px = five 22 px rows + four 1 px gaps.
        <ul className="max-h-[114px] space-y-px overflow-y-auto">
          {shown.map((vertex) => (
            <li key={vertex.id}>
              <button
                type="button"
                aria-pressed={selectedIds.includes(vertex.id)}
                onClick={() => onSelect(vertex.id)}
                className={cn(
                  "flex w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-left transition-colors",
                  selectedIds.includes(vertex.id)
                    ? "bg-signal-cmd/12 text-signal-cmd"
                    : "hover:bg-elevated",
                )}
              >
                <span className="instrument-label w-3 shrink-0 text-muted-foreground">
                  {vertexGlyph(vertex.type)}
                </span>
                <span className="readout min-w-0 flex-1 truncate text-[12px]">
                  {vertex.name}
                </span>
                {pendingIds.has(vertex.id) && (
                  // The toolbar Save's dot, so the eye links them; words for a screen reader.
                  <span className="flex shrink-0 items-center" title="Unsaved">
                    <span aria-hidden className="size-1.5 rounded-full bg-signal-caution" />
                    <span className="sr-only">(unsaved)</span>
                  </span>
                )}
                <span className="readout shrink-0 text-[11px] text-muted-foreground">
                  {vertex.x.toFixed(1)}, {vertex.y.toFixed(1)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
