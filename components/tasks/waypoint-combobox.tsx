"use client";

import * as React from "react";
import Link from "next/link";
import { Combobox } from "@base-ui/react/combobox";
import { CheckIcon, ChevronsUpDownIcon } from "lucide-react";

import type { ActiveVerticesStatus } from "@/hooks/use-active-map-vertices";
import { floorOfHeight } from "@/lib/map/floors";
import type { WaypointEditor } from "@/lib/map/links";
import { vertexGlyph } from "@/lib/map/vertex";
import type { MapFloor, MapVertex } from "@/lib/types/map";
import { cn } from "@/lib/utils";

interface WaypointItem {
  value: string;
  label: string;
  vertex: MapVertex;
  /** The job's stop numbers that already go here. */
  marks: readonly number[];
}

interface WaypointGroup {
  value: string;
  items: WaypointItem[];
}

export interface WaypointComboboxProps {
  vertices: MapVertex[];
  status: ActiveVerticesStatus;
  /** Named in the hint when the map has no waypoints yet. */
  mapName: string | null;
  /** The link offered then; null when the map has nothing to place them on. */
  waypointLink: WaypointEditor | null;
  /** The map's floors; more than one groups the list by floor. */
  floors: readonly MapFloor[];
  /** Vertex id → the stops that already go there, shown beside each name. */
  stopMarks: ReadonlyMap<string, readonly number[]>;
  /** Chargers first, for a Dock. */
  chargersFirst: boolean;
  value: string | null;
  disabled: boolean;
  onPick: (vertex: MapVertex) => void;
  /** The accessible name; the card adds its stop number. */
  label: string;
}

/**
 * A stop's waypoint, by name with a search: a site has dozens of them and a
 * plain dropdown made an engineer scroll for the one they could see on the
 * map. Grouped by floor on a map that spans storeys, and each name says which
 * stops already go there, so a patrol that returns is visible while picking.
 */
export function WaypointCombobox({
  vertices,
  status,
  mapName,
  waypointLink,
  floors,
  stopMarks,
  chargersFirst,
  value,
  disabled,
  onPick,
  label,
}: WaypointComboboxProps) {
  const groups = React.useMemo((): WaypointGroup[] => {
    const ordered = chargersFirst
      ? [...vertices].sort(
          (a, b) => Number(b.type === "CHARGE") - Number(a.type === "CHARGE"),
        )
      : vertices;
    const items = ordered.map(
      (vertex): WaypointItem => ({
        value: vertex.id,
        label: vertex.name,
        vertex,
        marks: stopMarks.get(vertex.id) ?? [],
      }),
    );
    if (floors.length < 2) return [{ value: "", items }];
    // Floors top first, as the floor picker lists them.
    const byFloor = new Map<string, WaypointItem[]>();
    for (const floor of [...floors].reverse()) byFloor.set(floor.name, []);
    const unplaced: WaypointItem[] = [];
    for (const item of items) {
      const floor = floorOfHeight(item.vertex.z, floors);
      const members = floor === null ? undefined : byFloor.get(floor);
      if (members) members.push(item);
      else unplaced.push(item);
    }
    const grouped = [...byFloor].map(([name, members]) => ({ value: name, items: members }));
    if (unplaced.length) grouped.push({ value: "Other", items: unplaced });
    return grouped.filter((group) => group.items.length > 0);
  }, [vertices, floors, stopMarks, chargersFirst]);

  if (status === "loading") return <Hint>Loading this map&apos;s waypoints…</Hint>;
  if (status === "no-map") return <Hint>Pick a map for this job first.</Hint>;
  if (status === "error") return <Hint>Could not load this map&apos;s waypoints.</Hint>;
  if (!vertices.length) {
    return (
      <Hint>
        {mapName ? (
          <>
            <span className="readout">{mapName}</span> has no waypoints yet
            {waypointLink ? (
              <>
                {" "}—{" "}
                <Link
                  href={waypointLink.href}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  place some
                </Link>{" "}
                on the {waypointLink.surface} first.
              </>
            ) : (
              ", and no floor plan or 3D map to place them on."
            )}
          </>
        ) : (
          "No waypoints to pick from."
        )}
      </Hint>
    );
  }

  const flat = groups.flatMap((group) => group.items);
  const selected = flat.find((item) => item.value === value) ?? null;
  const grouped = groups.length > 1 || groups[0]!.value !== "";

  const renderItem = (item: WaypointItem) => (
    <Combobox.Item
      key={item.value}
      value={item}
      className="relative flex cursor-default items-center gap-2 rounded-md py-1 pr-8 pl-1.5 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground pointer-coarse:py-2.5"
    >
      <span className="readout w-3 shrink-0 text-center text-[11px] text-muted-foreground" aria-hidden>
        {vertexGlyph(item.vertex.type)}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.marks.length > 0 && (
        <span className="readout shrink-0 text-[11px] text-signal-cmd">
          {item.marks.length === 1 ? "stop" : "stops"} {item.marks.join(", ")}
        </span>
      )}
      <Combobox.ItemIndicator className="absolute right-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-4" />
      </Combobox.ItemIndicator>
    </Combobox.Item>
  );

  return (
    <Combobox.Root
      items={grouped ? groups : flat}
      value={selected}
      disabled={disabled}
      isItemEqualToValue={(a: WaypointItem, b: WaypointItem) => a.value === b.value}
      itemToStringLabel={(item: WaypointItem) => item.label}
      onValueChange={(next: WaypointItem | null) => {
        if (next) onPick(next.vertex);
      }}
      autoHighlight
    >
      <Combobox.Trigger
        aria-label={label}
        className="flex h-7 w-full min-w-0 items-center justify-between gap-1.5 rounded-sm border border-input bg-transparent pr-1.5 pl-2 text-[13px] outline-none select-none hover:bg-elevated focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-popup-open:bg-elevated dark:bg-input/30 pointer-coarse:h-10"
      >
        <span className={cn("min-w-0 truncate", !selected && "text-muted-foreground")}>
          {selected?.label ?? "Pick a waypoint"}
        </span>
        <ChevronsUpDownIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </Combobox.Trigger>
      <Combobox.Portal>
        <Combobox.Positioner align="start" sideOffset={4} className="isolate z-50">
          <Combobox.Popup
            aria-label={label}
            className="w-(--anchor-width) min-w-56 max-w-(--available-width) origin-(--transform-origin) overflow-hidden rounded-lg bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10"
          >
            <div className="border-b border-hairline p-1">
              {/* 16 px under a finger, or iOS zooms the page on focus. */}
              <Combobox.Input
                placeholder="Search waypoints"
                className="h-7 w-full rounded-sm bg-transparent px-1.5 text-[13px] outline-none placeholder:text-muted-foreground pointer-coarse:text-base"
              />
            </div>
            <Combobox.Empty>
              <p className="px-2 py-3 text-[12px] text-muted-foreground">No waypoint by that name.</p>
            </Combobox.Empty>
            <Combobox.List className="max-h-[min(20rem,var(--available-height))] overflow-y-auto overscroll-contain p-1 data-empty:p-0">
              {grouped
                ? (group: WaypointGroup) => (
                    <Combobox.Group key={group.value} items={group.items} className="pb-1 last:pb-0">
                      <Combobox.GroupLabel className="instrument-label px-1.5 py-1 text-muted-foreground">
                        {group.value}
                      </Combobox.GroupLabel>
                      <Combobox.Collection>{renderItem}</Combobox.Collection>
                    </Combobox.Group>
                  )
                : renderItem}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="py-1 text-[11px] leading-tight text-muted-foreground">{children}</p>;
}
