"use client";

import type { MapSummary } from "@/lib/types/map";

/**
 * How the 3D map of the map just saved is going, under the floor plan's
 * line: the robot builds it in the same map cleaning that finishes the scan,
 * minutes after the save, and this dialog is where the save's outcome is
 * read. Nothing for `none`, which is most saves — a 3D map is built only when
 * the robot is set up to — and nothing until the catalogue has an entry.
 */
export function OctomapLine({ map }: { map: MapSummary | null }) {
  if (map === null) return null;

  switch (map.octomap_status) {
    case "converting":
      return (
        <p className="text-[11px] leading-snug text-signal-active">
          Building the 3D map…
        </p>
      );
    case "ok":
      return (
        <p className="text-[11px] leading-snug text-signal-live">
          3D map ready — the dashboard can show it.
        </p>
      );
    case "failed":
      // The robot's own reason, verbatim.
      return (
        <p className="text-[11px] leading-snug text-signal-warn">
          The 3D map could not be built:{" "}
          {map.octomap_error ?? "the robot did not record a reason"}. The scan
          and the floor plan are not affected.
        </p>
      );
    case "interrupted":
      return (
        <p className="text-[11px] leading-snug text-signal-caution">
          The 3D map was not finished — the robot stopped partway through. The
          scan and the floor plan are not affected.
        </p>
      );
    default:
      return null;
  }
}
