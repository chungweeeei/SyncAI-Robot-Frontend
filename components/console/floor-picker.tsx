"use client";

import * as React from "react";

import { overlayPanel } from "@/components/console/instrument";
import { cn } from "@/lib/utils";
import type { MapFloor } from "@/lib/types/map";

/**
 * Which floor of a multi-storey 3D map is on show: a pill-shaped column in
 * the 3D view's top-right corner — All at the top, then each floor, the top
 * floor first, as a lift's panel reads. Shared by the dashboard's 3D map
 * and the 3D map page, so a floor reads the same on both. Pressed buttons in
 * a named group rather than a radio group: each is one press that changes
 * the view, and a screen reader hears "Floor, 2F, pressed".
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
    ...[...floors]
      .sort((a, b) => b.level - a.level)
      .map((floor) => ({ key: floor.name, label: floor.name })),
  ];
  return (
    <div
      role="group"
      aria-label="Floor"
      className={cn(
        overlayPanel,
        // Round at both ends: the outer edge, and the first and last buttons
        // inside it, so a pressed end fills the curve.
        "flex w-12 flex-col gap-1 rounded-full p-1 pointer-coarse:w-14",
        className,
      )}
    >
      {options.map((option, i) => {
        const pressed = option.key === value;
        return (
          <button
            key={option.key ?? "\u0000all"}
            type="button"
            aria-pressed={pressed}
            title={option.key === null ? "Show every floor" : `Show ${option.label}`}
            onClick={() => onChange(option.key)}
            className={cn(
              "readout h-7 w-full truncate rounded-sm border px-1 text-[11px] pointer-coarse:h-10",
              i === 0 && "rounded-t-full",
              i === options.length - 1 && "rounded-b-full",
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
