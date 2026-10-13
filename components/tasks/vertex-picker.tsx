"use client";

import * as React from "react";
import Link from "next/link";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import { waypointEditorHref } from "@/lib/map/links";
import type { MapVertex } from "@/lib/types/map";

export interface VertexPickerProps {
  vertices: MapVertex[];
  status: ActiveVerticesStatus;
  /** For the deep link offered when the active map has no vertices yet. */
  mapName: string | null;
  /** The vertex the row's numbers came from; null once they were hand edited. */
  value: string | null;
  disabled: boolean;
  onPick: (vertex: MapVertex) => void;
  /**
   * The accessible name, since there is no visible label and a placeholder
   * goes once picked. The row adds its step number to tell MOVE rows apart.
   */
  label?: string;
}

/**
 * Set a MOVE step from a stop on the map. The only way to set one (there are
 * no coordinate fields), so each unavailable case says what to do on the map.
 * A vertex is already in the MOVE step's units; only the angle is folded.
 */
export function VertexPicker({
  vertices,
  status,
  mapName,
  value,
  disabled,
  onPick,
  label = "Waypoint",
}: VertexPickerProps) {
  if (status === "loading") {
    return <Hint>Loading this map&apos;s waypoints…</Hint>;
  }

  if (status === "no-map") {
    return <Hint>Pick a map for this job first; its waypoints can be picked here.</Hint>;
  }

  if (status === "error") {
    return <Hint>Could not load this map&apos;s waypoints.</Hint>;
  }

  if (!vertices.length) {
    return (
      <Hint>
        {mapName ? (
          <>
            <span className="readout">{mapName}</span> has no waypoints yet —{" "}
            <Link
              href={waypointEditorHref(mapName, { from: "tasks" })}
              className="underline underline-offset-2 hover:text-foreground"
            >
              place some
            </Link>{" "}
            on the floor plan first.
          </>
        ) : (
          "No waypoints to pick from."
        )}
      </Hint>
    );
  }

  return (
    <Select
      // Without `items`, SelectValue shows the raw uuid instead of the label.
      items={vertices.map((vertex) => ({ value: vertex.id, label: vertex.name }))}
      // null is "nothing selected", so no sentinel item is needed.
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const vertex = vertices.find((entry) => entry.id === next);
        if (vertex) onPick(vertex);
      }}
    >
      <SelectTrigger size="sm" aria-label={label} className="w-full rounded-sm text-[13px]">
        <SelectValue placeholder="Pick a waypoint" />
      </SelectTrigger>
      <SelectContent>
        {vertices.map((vertex) => (
          <SelectItem key={vertex.id} value={vertex.id}>
            <span className="truncate">{vertex.name}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] leading-tight text-muted-foreground">{children}</p>
  );
}
