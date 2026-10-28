"use client";

import Link from "next/link";

import type { MapSummary } from "@/lib/types/map";

/**
 * How the 3D map of the map just saved is going: the robot builds it in the
 * map cleaning that finishes the scan, minutes after the save, and this
 * dialog is where the save's outcome is read. Nothing for `none` — the build
 * has not started, or the robot could not start its cleaning, which the
 * save's own sentence says — and nothing until the catalogue has an entry.
 */
export function OctomapLine({ map }: { map: MapSummary | null }) {
  if (map === null) return null;

  const unusable = "The scan is saved, but the robot cannot navigate on this map without one.";

  switch (map.octomap_status) {
    case "converting":
      return (
        <p className="text-[11px] leading-snug text-signal-active">
          Building the 3D map… this takes several minutes.
        </p>
      );
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
