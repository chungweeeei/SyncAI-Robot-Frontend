"use client";

import * as React from "react";

/**
 * A floor's height band as an object that only changes when its two numbers
 * do. The floors are a fresh list on every refetch, so a band read straight
 * off one is a new object each time, and the 3D views repaint their layer —
 * every cell's colour — whenever the band they are handed is.
 */
export function useFloorBand(
  floor: { lo: number; hi: number } | null,
): { lo: number; hi: number } | null {
  const lo = floor?.lo;
  const hi = floor?.hi;
  return React.useMemo(
    () => (lo === undefined || hi === undefined ? null : { lo, hi }),
    [lo, hi],
  );
}
