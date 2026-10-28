"use client";

import Link from "next/link";
import { PencilIcon } from "lucide-react";

import { useMapRunLock } from "@/hooks/use-map-run-lock";
import { canEditMap, mapEditorHref } from "@/lib/map/links";
import { cn } from "@/lib/utils";
import type { MapSummary } from "@/lib/types/map";

const NOTHING_TO_EDIT_REASON = "This map has no 3D map to edit.";
const BUILDING_REASON =
  "The robot is still building this map's 3D map. Wait for it to finish.";

/**
 * The corner tile one slot in from the X: 8 px inset + 24 px tile + 6 px gap
 * = 38 px (`right-9.5`). Same surface as the other tiles, copied.
 */
const CORNER =
  "absolute top-2 right-9.5 z-10 flex size-6 items-center justify-center rounded-sm border border-hairline bg-panel/90 backdrop-blur-sm";

/**
 * The way into the map's editor, as a pencil tile beside the X: the top
 * edge reads as the card's verbs (switch, edit, delete). It opens the
 * editor on the map's 3D map.
 *
 * Greyed while a job drives on this map — not merely because it is in use:
 * the backend saves onto the live map and reloads it, but refuses a write a
 * running job would pick up mid-route (the same run lock as the editor).
 * Also greyed with nothing to open: no finished 3D map. A look-alike span,
 * since `disabled` swallows the tooltip.
 */
export function MapEditLink({ map }: { map: MapSummary }) {
  const runLock = useMapRunLock(map.name);
  const editable = canEditMap(map);
  const label = `Edit ${map.name}`;

  if (runLock.locked || !editable) {
    return (
      <span
        aria-disabled="true"
        title={
          runLock.locked
            ? (runLock.reason ?? undefined)
            : map.octomap_status === "converting"
              ? BUILDING_REASON
              : NOTHING_TO_EDIT_REASON
        }
        className={cn(
          CORNER,
          "cursor-not-allowed text-muted-foreground opacity-40",
        )}
      >
        <PencilIcon className="size-3.5" aria-hidden />
      </span>
    );
  }

  return (
    <Link
      href={mapEditorHref(map.name)}
      aria-label={label}
      title={label}
      className={cn(
        CORNER,
        "text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-elevated hover:text-foreground",
      )}
    >
      <PencilIcon className="size-3.5" aria-hidden />
    </Link>
  );
}
