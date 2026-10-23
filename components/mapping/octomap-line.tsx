"use client";

import Link from "next/link";

import type { MapSummary } from "@/lib/types/map";

/**
 * How the 3D map of the map just saved is going, under the floor plan's
 * line: the robot builds it in the same map cleaning that finishes the scan,
 * minutes after the save, and this dialog is where the save's outcome is
 * read. Nothing for `none` — the operator did not tick it, or the robot could
 * not start its cleaning, which the save's own sentence says — and nothing
 * until the catalogue has an entry.
 *
 * A save may have asked for the 3D map alone, so every line checks whether
 * there is a floor plan before naming one: "the floor plan is not affected"
 * over a map that has none would send the operator looking for it.
 */
export function OctomapLine({ map }: { map: MapSummary | null }) {
  if (map === null) return null;

  // `none` is a save that did not ask; every other state is one that did.
  const hasGrid = map.grid_status !== "none";
  const unaffected = hasGrid
    ? "The scan and the floor plan are not affected."
    : "The scan is saved — build a floor plan from the map library to use this map.";

  switch (map.octomap_status) {
    case "converting":
      return (
        <p className="text-[11px] leading-snug text-signal-active">
          Building the 3D map… this takes several minutes.
        </p>
      );
    case "ok":
      return hasGrid ? (
        <p className="text-[11px] leading-snug text-signal-live">
          3D map ready — the dashboard can show it.
        </p>
      ) : (
        <p className="text-[11px] leading-snug text-signal-live">
          3D map ready — this map is ready to use.{" "}
          <Link href="/maps" className="underline underline-offset-2">
            Open the map library
          </Link>
        </p>
      );
    case "failed":
      // The robot's own reason, verbatim.
      return (
        <p className="text-[11px] leading-snug text-signal-warn">
          The 3D map could not be built:{" "}
          {map.octomap_error ?? "the robot did not record a reason"}. {unaffected}
        </p>
      );
    case "interrupted":
      return (
        <p className="text-[11px] leading-snug text-signal-caution">
          The 3D map was not finished — the robot stopped partway through.{" "}
          {unaffected}
        </p>
      );
    default:
      return null;
  }
}
