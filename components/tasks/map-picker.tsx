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
 * Which map a job's Move steps are placed on. Defaults to the loaded map; the
 * choice is for authoring a job for another floor, which saves here and runs
 * once that map is loaded.
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
    // "loaded", the status strip's and Maps screen's word, not "active".
    label: map.active ? `${map.name} · loaded` : map.name,
  }));

  return (
    <div className="flex items-center gap-1.5">
      <label htmlFor={id} className="instrument-label text-muted-foreground">
        Map
      </label>
      <Select
        // Without `items`, SelectValue shows the raw value instead of the label.
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
