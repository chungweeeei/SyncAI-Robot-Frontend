"use client";

import * as React from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MapSummary } from "@/lib/types/map";

export interface MapPickerProps {
  /** The catalogue, or null before it answers. */
  maps: MapSummary[] | null;
  /** The map the editor is authoring for; null when there is none to author for. */
  value: string | null;
  disabled: boolean;
  onPick: (name: string) => void;
}

/**
 * Which map a job's Move steps are placed on.
 *
 * Defaults to the map the robot has loaded, and that is the only case most
 * operators ever see. It exists for the other one: a job for the site's second
 * floor, authored while the robot is on the first. The waypoints, the floor
 * plan and the saved `map_name` all follow this choice; what does not is
 * running — a job for another map can be saved here and run once that map is
 * loaded, and the dispatch pane says so.
 */
export function MapPicker({ maps, value, disabled, onPick }: MapPickerProps) {
  const id = React.useId();

  if (maps !== null && maps.length === 0) {
    return (
      <span className="text-[11px] leading-tight text-muted-foreground">
        No maps on this robot yet.
      </span>
    );
  }

  const items = (maps ?? []).map((map) => ({
    value: map.name,
    // "loaded" rather than "active": the word on the status strip and the
    // Maps screen for the map the robot is on.
    label: map.active ? `${map.name} · loaded` : map.name,
  }));

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="instrument-label text-muted-foreground">
        Map
      </label>
      <Select
        // `items` is what makes SelectValue render the label; without it the
        // trigger shows the raw value.
        items={items}
        value={value}
        disabled={disabled || maps === null}
        onValueChange={(next) => {
          if (next !== null) onPick(next);
        }}
      >
        <SelectTrigger id={id} size="sm" className="h-6 min-w-32 rounded-sm text-[12px]">
          <SelectValue placeholder="Pick a map" />
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
