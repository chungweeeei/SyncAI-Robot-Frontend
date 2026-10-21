"use client";

import Link from "next/link";
import { MountainIcon } from "lucide-react";

import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { map3dHref } from "@/lib/map/links";
import { cn } from "@/lib/utils";
import type { MapSummary } from "@/lib/types/map";

const NO_TREE_REASON = "This map has no 3D map.";
const BUILDING_REASON = "The robot is still building this map's 3D map. Wait for it to finish.";

/** The corner tile one slot in from the pencil: 8 px inset + two 24 px tiles + two 6 px gaps. */
const CORNER =
  "absolute top-2 right-17 z-10 flex size-6 items-center justify-center rounded-sm border border-hairline bg-panel/90 backdrop-blur-sm";

/**
 * The way into the 3D map page, a third corner tile beside the pencil,
 * shown as a verb like the others: the map's waypoints on its 3D map. Needs
 * the robot's 3D map and nothing else — not a floor plan, since a scan-only
 * save still has stops to place. Greyed while a job drives on the map, like
 * Edit: both are map writes the backend refuses then.
 */
export function MapGroundLink({ map }: { map: MapSummary }) {
  const runLock = useMapRunLock(map.name);
  const status = map.octomap_status;

  if (status === "none" || status === "failed" || status === "interrupted") return null;

  if (runLock.locked || status === "converting") {
    return (
      <span
        aria-disabled="true"
        title={runLock.locked ? (runLock.reason ?? undefined) : status === "converting" ? BUILDING_REASON : NO_TREE_REASON}
        className={cn(CORNER, "cursor-not-allowed text-muted-foreground opacity-40")}
      >
        <MountainIcon className="size-3.5" aria-hidden />
      </span>
    );
  }

  return (
    <Link
      href={map3dHref(map.name)}
      aria-label={`Open the 3D map of ${map.name}`}
      title={`Open the 3D map of ${map.name}`}
      className={cn(
        CORNER,
        "text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-elevated hover:text-foreground",
      )}
    >
      <MountainIcon className="size-3.5" aria-hidden />
    </Link>
  );
}
