"use client";

import { DownloadIcon } from "lucide-react";

import { useExportMap } from "@/hooks/use-map-actions";
import type { MapSummary } from "@/lib/types/map";

const CONVERTING_REASON =
  "This map is still being prepared. Wait for it to finish, then export it.";

/**
 * A size up from the chips it shares the row with, and in `signal-live`: of
 * the console's hues it is the one that means "sound and safe to take", which
 * is what a download is — the only map verb on the card that cannot change
 * anything on the robot, so it is also the only one that may wear a colour
 * at rest. `h-7` is Button's `sm`, so it lines up with the Import button.
 */
const FACE =
  "ml-auto flex h-7 items-center gap-1.5 rounded-sm border px-2.5 text-xs font-semibold tracking-wide pointer-coarse:min-h-10";
const LIVE = "border-signal-live/40 bg-signal-live/10 text-signal-live";

/**
 * The card-side face of GET /api/v1/maps/{name}/export.
 *
 * A word in the chip row next to Edit, because that is what it is: a way to
 * take the map somewhere, not a change to it. The archive is the whole
 * directory plus the waypoints, so it is how a site's map moves to another
 * robot or into a backup — the import control above the grid is the other half.
 *
 * Offered on the map in use as well: reading the directory disturbs nothing
 * the stack holds open, which is why this is the one map verb the active card
 * is not greyed for. Greyed mid-conversion, with the reason in the tooltip,
 * because the floor plan files are being rewritten and the backend would
 * answer 409 rather than hand out a torn archive.
 *
 * No dialog: a download is reversible by deleting the file. The one sentence
 * this can produce is the refusal, and it goes below the row rather than in
 * the library's status line, because unlike a rename or a delete the card is
 * still here to show it. `basis-full` is what wraps it to its own line inside
 * the parent's flex-wrap row, and `ml-auto` on the face is what pushes it and
 * Edit to the right of the chips.
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
        className={`${FACE} ${LIVE} cursor-not-allowed opacity-40`}
      >
        <DownloadIcon className="size-3.5" aria-hidden />
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
        className={`${FACE} ${LIVE} transition-colors hover:border-signal-live/70 hover:bg-signal-live/20 disabled:cursor-progress disabled:opacity-60`}
      >
        <DownloadIcon className="size-3.5" aria-hidden />
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
