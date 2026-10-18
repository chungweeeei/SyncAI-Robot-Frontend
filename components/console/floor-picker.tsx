"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import type { MapFloor } from "@/lib/types/map";

/**
 * Which floor of a multi-storey 3D map is on show: All, then each floor
 * lowest first. Shared by the dashboard's 3D map and the ground editor, so
 * a floor reads the same on both. Pressed buttons in a named group rather
 * than a radio group: each is one press that changes the view, and a
 * screen reader hears "Floor, 2F, pressed".
 */
export function FloorPicker({
  floors,
  value,
  onChange,
  allLabel = "All",
  className,
}: {
  floors: readonly MapFloor[];
  /**
   * The floor's name, null for the whole map, or undefined for heights set
   * some other way (the ground editor's sliders), which presses nothing.
   */
  value: string | null | undefined;
  onChange: (name: string | null) => void;
  /** What the whole map is called here. */
  allLabel?: string;
  className?: string;
}) {
  const options: { key: string | null; label: string }[] = [
    { key: null, label: allLabel },
    ...floors.map((floor) => ({ key: floor.name, label: floor.name })),
  ];
  return (
    <div role="group" aria-label="Floor" className={cn("flex flex-wrap gap-1", className)}>
      {options.map((option) => {
        const pressed = option.key === value;
        return (
          <button
            key={option.key ?? "\u0000all"}
            type="button"
            aria-pressed={pressed}
            onClick={() => onChange(option.key)}
            className={cn(
              "readout h-6 min-w-8 rounded-sm border px-1.5 text-[11px] pointer-coarse:h-10 pointer-coarse:min-w-10",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              pressed
                ? "border-signal-cmd bg-signal-cmd/15 text-signal-cmd"
                : "border-hairline text-muted-foreground hover:text-foreground",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
