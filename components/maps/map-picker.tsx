"use client";

import * as React from "react";

import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { MapSummary } from "@/lib/types/map";
import { cn } from "@/lib/utils";

export interface MapPickerProps {
  /** The catalogue, or null before it answers. */
  maps: MapSummary[] | null;
  /** The map picked; null when there is none. */
  value: string | null;
  disabled: boolean;
  onPick: (name: string) => void;
  /**
   * `inline` (the default) is a toolbar's: a caps label beside a compact
   * trigger. `stacked` is a dialog's field: the label over a trigger of the
   * dialog's width.
   */
  layout?: "inline" | "stacked";
}

/**
 * One of the robot's maps, by name. The task editor's choice of which map a
 * job's Move steps are placed on (for authoring a job for another floor, which
 * saves here and runs once that map is loaded) and the mapping screen's of
 * which map to keep building. Every map is listed: what a caller may do with
 * one is its own rule, said by its own refusal.
 */
export function MapPicker({ maps, value, disabled, onPick, layout = "inline" }: MapPickerProps) {
  const id = React.useId();
  const stacked = layout === "stacked";

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
    <div className={stacked ? "space-y-1.5" : "flex items-center gap-1.5"}>
      {stacked ? (
        <Label htmlFor={id} className="text-xs">
          Map
        </Label>
      ) : (
        <label htmlFor={id} className="instrument-label text-muted-foreground">
          Map
        </label>
      )}
      <Select
        // Without `items`, SelectValue shows the raw value instead of the label.
        items={items}
        value={value}
        disabled={disabled || maps === null}
        onValueChange={(next) => {
          if (next !== null) onPick(next);
        }}
      >
        <SelectTrigger
          id={id}
          size={stacked ? "default" : "sm"}
          className={cn("rounded-sm", stacked ? "readout w-full" : "min-w-32 text-[12px]")}
        >
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
