"use client";

import { DownloadIcon } from "lucide-react";

import { useExportMap } from "@/hooks/use-map-actions";
import type { MapSummary } from "@/lib/types/map";

const CONVERTING_REASON =
  "This map is still being prepared. Wait for it to finish, then export it.";

/** The Edit link's geometry, so the two read as one row of verbs. */
const FACE =
  "instrument-label ml-auto flex h-5 items-center gap-1 rounded-sm border border-hairline px-1.5 text-muted-foreground pointer-coarse:min-h-10";

/**
 * The card-side face of GET /api/v1/maps/{name}/export: the whole directory
 * plus waypoints, for another robot or a backup (Import is the other half).
 *
 * Offered on the map in use — reading disturbs nothing the stack holds open.
 * Greyed mid-conversion, when the backend would 409 rather than hand out a
 * torn archive. No dialog: a download is undone by deleting the file. A
 * refusal goes below the row (`basis-full` wraps it inside the parent's
 * flex-wrap), since the card is still here to show it.
 */
export function MapExportControl({ map }: { map: MapSummary }) {
  const exporting = useExportMap();

  const busy = exporting.isPending;
  const error = exporting.error?.message ?? null;

  if (map.grid_status === "converting") {
    return (
      <span
        aria-disabled="true"
        title={CONVERTING_REASON}
        className={`${FACE} cursor-not-allowed opacity-40`}
      >
        <DownloadIcon className="size-3" aria-hidden />
        Export
      </span>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={busy}
        aria-label={`Export ${map.name}`}
        title={`Export ${map.name} as a zip archive`}
        onClick={() => exporting.mutate({ name: map.name })}
        className={`${FACE} transition-colors hover:bg-elevated hover:text-foreground disabled:cursor-progress disabled:opacity-60`}
      >
        <DownloadIcon className="size-3" aria-hidden />
        {busy ? "Exporting…" : "Export"}
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
