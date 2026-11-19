"use client";

import Link from "next/link";

import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { buildPercent } from "@/lib/map/build-progress";
import type { MapSummary } from "@/lib/types/map";

/**
 * How the 3D map of the map just saved is going: the robot builds it in the
 * map cleaning that finishes the scan, minutes after the save, and this
 * dialog is where the save's outcome is read — while it builds, as a bar at
 * the robot's own percent. Nothing for `none` — the build
 * has not started, or the robot could not start its cleaning, which the
 * save's own sentence says — and nothing until the catalogue has an entry.
 */
export function OctomapLine({ map }: { map: MapSummary | null }) {
  if (map === null) return null;

  const unusable = "The scan is saved, but the robot cannot navigate on this map without one.";

  switch (map.octomap_status) {
    case "converting": {
      // The robot's own count of its build, read on the catalogue's poll; the
      // fill eases to each new reading, since they arrive seconds apart. With
      // none to read (the build is queued behind another map's, or the robot
      // reports none) the bar has no value and no number, never 0%.
      const percent = buildPercent(map.octomap_progress);
      return (
        <div className="space-y-1.5">
          <Progress
            value={percent}
            className="gap-x-3 gap-y-1.5"
            indicatorClassName="bg-signal-active duration-700 ease-out"
          >
            <ProgressLabel className="text-[11px] leading-snug font-normal text-signal-active">
              Building the 3D map…
            </ProgressLabel>
            <ProgressValue className="readout text-[11px] leading-snug text-signal-active" />
          </Progress>
          <p className="text-[11px] leading-snug text-muted-foreground">
            This takes several minutes.
          </p>
        </div>
      );
    }
    case "ok":
      return (
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
          {map.octomap_error ?? "the robot did not record a reason"}. {unusable}
        </p>
      );
    case "interrupted":
      return (
        <p className="text-[11px] leading-snug text-signal-caution">
          The 3D map was not finished — the robot stopped partway through.{" "}
          {unusable}
        </p>
      );
    default:
      return null;
  }
}
