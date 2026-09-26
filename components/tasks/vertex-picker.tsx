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
}

/**
 * Set a MOVE step from a stop already placed on the active map.
 *
 * This is the only way to set one: the composer has no coordinate fields, so
 * every unavailable case below says what to do on the map instead, and the row
 * stays unsendable until a waypoint is picked. A vertex stores x/y in metres and theta in
 * degrees in the map frame precisely so it can be handed to a MOVE step without
 * conversion — the only thing done to it on the way in is the angle fold.
 */
export function VertexPicker({
  vertices,
  status,
  mapName,
  value,
  disabled,
  onPick,
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
              href={`/maps/${encodeURIComponent(mapName)}/edit`}
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
      // `items` is what makes SelectValue render the *label*; without it the
      // trigger shows the raw uuid this is keyed by.
      items={vertices.map((vertex) => ({ value: vertex.id, label: vertex.name }))}
      // base-ui accepts null for "nothing selected", so there is no sentinel item
      // for "hand edited" — the label simply clears.
      value={value}
      disabled={disabled}
      onValueChange={(next) => {
        const vertex = vertices.find((entry) => entry.id === next);
        if (vertex) onPick(vertex);
      }}
    >
      <SelectTrigger size="sm" className="w-full rounded-sm text-[13px]">
        <SelectValue placeholder="Pick a waypoint" />
      </SelectTrigger>
      <SelectContent>
        {vertices.map((vertex) => (
          <SelectItem key={vertex.id} value={vertex.id}>
            {vertex.name}
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
