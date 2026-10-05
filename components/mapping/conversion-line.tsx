"use client";

import Link from "next/link";

import type { MapSummary } from "@/lib/types/map";

/**
 * How the 2D-grid conversion of the map just saved is going.
 *
 * The other half of Save, and the reason this line exists: saving writes
 * the cloud, then the backend converts it to the gridmap the nav stack actually
 * loads — on a background thread, over tens of seconds, long after the POST has
 * answered. Until this line existed the flow ended at "converting in the
 * background", with the outcome visible only on the Maps screen, so an operator
 * who saved and stayed here was never told whether the map they just made is
 * usable. Saving and converting are one act to the person doing it; only the
 * backend has a reason to see two.
 *
 * Shown in the save dialog while it is open and in the read-back under the
 * run strip once it is closed — the same line in both, because the operator
 * closing the dialog has not stopped caring how the floor plan turned out.
 *
 * Renders nothing until the catalogue has an entry to report, which covers the
 * seconds between the save landing and the first poll.
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
      // The backend's own diagnosis, verbatim. It names what the pipeline
      // rejected ("intensity/normal gate selected no ground points"), which is
      // the only thing that tells an operator whether to try the other recipe
      // or go and look at the cloud.
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
      // "none": the save answered before the conversion started, or it never
      // did (no map.pcd). The backend's save message already says to run the
      // conversion by hand, so a second sentence here would only repeat it.
      return null;
  }
}
