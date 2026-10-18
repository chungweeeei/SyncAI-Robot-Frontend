"use client";

import * as React from "react";

import { overlayPanel } from "@/components/console/instrument";
import { rampColor } from "@/lib/theme/height-ramp";
import { cn } from "@/lib/utils";
import type { MapFloor } from "@/lib/types/map";

/**
 * Where on the height ramp a floor's swatch sits, lowest floor to highest.
 * Inside the ramp's ends: its violet foot is near-black on a dark panel and
 * its red head reads as a fault, and a swatch only has to say "lower" or
 * "higher", as the 3D map does under All.
 */
const SWATCH_LO = 0.2;
const SWATCH_HI = 0.88;

/** A floor's swatch colour, by its level among the others. */
function swatchColor(level: number, lo: number, hi: number): string {
  const t = hi > lo ? SWATCH_LO + ((level - lo) / (hi - lo)) * (SWATCH_HI - SWATCH_LO) : SWATCH_LO;
  const [r, g, b] = rampColor(t, [0, 0, 0]);
  return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
}

/**
 * Which floor of a multi-storey 3D map is on show: a pill-shaped column in
 * the 3D view's top-right corner — All at the top, then each floor, the top
 * floor first, as a lift's panel reads. Shared by the dashboard's 3D map and
 * the 3D map page, so a floor reads the same on both.
 *
 * The floor on show is a solid pill that slides to the button pressed, so
 * the change is seen where the eye already is. Each floor carries a swatch
 * of the height ramp the 3D map is drawn in, so the column doubles as the
 * key to the map's colours: the ground floor cool, the floors above warmer.
 * Pressed buttons in a named group rather than a radio group: each is one
 * press that changes the view, and a screen reader hears "Floor, 2F, pressed".
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
  const levels = floors.map((floor) => floor.level);
  const lo = Math.min(...levels);
  const hi = Math.max(...levels);
  const options: { key: string | null; label: string; swatch: string | null }[] = [
    { key: null, label: allLabel, swatch: null },
    ...[...floors]
      .sort((a, b) => b.level - a.level)
      .map((floor) => ({
        key: floor.name,
        label: floor.name,
        swatch: swatchColor(floor.level, lo, hi),
      })),
  ];
  const index = options.findIndex((option) => option.key === value);

  return (
    <div
      role="group"
      aria-label="Floor"
      className={cn(
        overlayPanel,
        "relative flex w-14 flex-col gap-1 rounded-full p-1 pointer-coarse:w-16",
        className,
      )}
    >
      {/* The pill under the floor on show. One button's height, moved by
        * whole buttons plus the gap between them, so it lands exactly on
        * either size of button. None for heights the sliders set. */}
      {index >= 0 && (
        <span
          aria-hidden
          className="absolute inset-x-1 top-1 h-8 rounded-full bg-signal-cmd shadow-sm transition-transform duration-200 ease-out motion-reduce:transition-none pointer-coarse:h-10"
          style={{ transform: `translateY(calc(${index} * (100% + 0.25rem)))` }}
        />
      )}
      {options.map((option) => {
        const pressed = option.key === value;
        return (
          <button
            key={option.key ?? "\u0000all"}
            type="button"
            aria-pressed={pressed}
            title={option.key === null ? "Show every floor" : `Show ${option.label}`}
            onClick={() => onChange(option.key)}
            className={cn(
              "readout relative flex h-8 w-full items-center justify-center gap-1.5 rounded-full px-1.5 text-[11px] transition-colors pointer-coarse:h-10",
              "focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
              pressed
                ? "font-semibold text-primary-foreground"
                : "text-muted-foreground hover:bg-elevated hover:text-foreground",
            )}
          >
            {option.swatch && (
              <span
                aria-hidden
                className={cn(
                  "size-1.5 shrink-0 rounded-full",
                  pressed && "ring-1 ring-primary-foreground",
                )}
                style={{ background: option.swatch }}
              />
            )}
            <span className="truncate">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
