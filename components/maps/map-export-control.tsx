"use client";

import { DownloadIcon } from "lucide-react";

import { useExportMap } from "@/hooks/use-map-actions";
import type { MapSummary } from "@/lib/types/map";

/** The Edit link's geometry, so the two read as one row of verbs. */
const FACE =
  "instrument-label ml-auto flex h-5 items-center gap-1 rounded-sm border border-hairline px-1.5 text-muted-foreground pointer-coarse:min-h-10";

/**
 * The card-side face of GET /api/v1/maps/{name}/export: the whole directory
 * plus waypoints, for another robot or a backup (Import is the other half).
 *
 * Offered on the map in use — reading disturbs nothing the stack holds open.
 * No dialog: a download is undone by deleting the file. A
 * refusal goes below the row (`basis-full` wraps it inside the parent's
 * flex-wrap), since the card is still here to show it.
 *
 * While the archive downloads the label counts up in percent and the face
 * fills behind it: a map is a few hundred MB, minutes over a weak link. Before
 * the first byte (the robot is still building the archive) it reads
 * "Exporting…", since there is no total to measure yet.
 */
export function MapExportControl({ map }: { map: MapSummary }) {
  const exporting = useExportMap();

  const busy = exporting.isPending;
  const progress = exporting.progress;
  const error = exporting.error?.message ?? null;

  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Export ${map.name}`}
        title={`Export ${map.name} as a zip archive`}
        onClick={() => exporting.mutate({ name: map.name })}
        className={`${FACE} relative overflow-hidden transition-colors hover:bg-elevated hover:text-foreground disabled:cursor-progress disabled:opacity-60`}
      >
        {progress !== null && (
          // The fill is decoration; the label's percent is the reading (a
          // role inside a button is flattened away by assistive tech anyway).
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 bg-signal-live/20"
            style={{ width: `${progress}%` }}
          />
        )}
        <DownloadIcon className="relative size-3" aria-hidden />
        <span className="relative tabular-nums">
          {progress !== null ? `Exporting ${progress}%` : busy ? "Exporting…" : "Export"}
        </span>
      </button>
      {error && (
        <p
          role="alert"
          className="basis-full text-[11px] leading-snug text-signal-warn"
        >
          {error}
        </p>
      )}
    </>
  );
}
