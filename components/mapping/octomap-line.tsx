"use client";

import type { MapSummary } from "@/lib/types/map";

/**
 * How the robot's 3D map of the map just saved is going.
 *
 * The robot starts this build itself once the save has written the scan, and
 * it runs for minutes after the floor plan is ready — so it gets its own line
 * under `ConversionLine` rather than a state of that one: the two finish at
 * different times, for different reasons, and a failed 3D map costs nothing
 * the floor plan gave. The copy says so, because an operator reading "could
 * not be built" next to a ready floor plan needs to know which of the two
 * the robot can drive on.
 *
 * Renders nothing for "none": the save answered before the robot wrote its
 * first word about the build, or the robot is not set up to build one.
 */
export function OctomapLine({ map }: { map: MapSummary | null }) {
  if (map === null) return null;

  switch (map.octomap_status) {
    case "converting":
      return (
        <p className="text-[11px] leading-snug text-signal-active">
          Building the 3D map… this can take a few minutes.
        </p>
      );
    case "ok":
      return (
        <p className="text-[11px] leading-snug text-signal-live">
          3D map ready — turn on the 3D map layer on the dashboard to view it.
        </p>
      );
    case "failed":
      return (
        <p className="text-[11px] leading-snug text-signal-warn">
          The 3D map could not be built:{" "}
          {map.octomap_error ?? "the robot did not record a reason"}. The scan and
          floor plan are unaffected.
        </p>
      );
    case "interrupted":
      return (
        <p className="text-[11px] leading-snug text-signal-caution">
          The 3D map was not finished — the robot stopped partway through. The
          scan and floor plan are unaffected.
        </p>
      );
    default:
      return null;
  }
}
