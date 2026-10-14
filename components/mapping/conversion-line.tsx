"use client";

import Link from "next/link";

import type { MapSummary } from "@/lib/types/map";

/**
 * How the floor plan conversion of the map just saved is going. Saving writes
 * the scan, then the backend converts it on a background thread for tens of
 * seconds after the POST answers; to the operator it is one act, so the save
 * dialog says how it went. After Close the outcome is on the Maps screen.
 *
 * Renders nothing until the catalogue has an entry, which covers the seconds
 * before the first poll.
 */
export function ConversionLine({ map }: { map: MapSummary | null }) {
  if (map === null) return null;

  switch (map.grid_status) {
    case "converting":
      return (
        <p className="text-[11px] leading-snug text-signal-active">
          Building the floor plan…
        </p>
      );
    case "ok":
      return (
        <p className="text-[11px] leading-snug text-signal-live">
          Floor plan ready — this map is ready to use.{" "}
          <Link href="/maps" className="underline underline-offset-2">
            Open the map library
          </Link>
        </p>
      );
    case "failed":
      // The backend's diagnosis, verbatim: what the pipeline rejected is what
      // tells the operator whether to retry or go look at the scan.
      return (
        <p className="text-[11px] leading-snug text-signal-warn">
          The floor plan could not be built:{" "}
          {map.grid_error ?? "the robot did not record a reason"}. The scan is
          saved — rebuild the floor plan from the map library.
        </p>
      );
    case "interrupted":
      return (
        <p className="text-[11px] leading-snug text-signal-caution">
          The floor plan was not finished — the robot restarted partway through.
          The scan is saved; rebuild the floor plan from the map library.
        </p>
      );
    default:
      // "none": the save answered before conversion started, or it never did;
      // the save's own message already says so.
      return null;
  }
}
