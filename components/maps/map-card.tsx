"use client";

import Link from "next/link";
import { BoxIcon, CheckIcon, LayersIcon, PencilIcon } from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { GridRebuildControl } from "@/components/maps/grid-rebuild-control";
import { MapActivateControl } from "@/components/maps/map-activate-control";
import { MapDeleteControl } from "@/components/maps/map-delete-control";
import { MapEditLink } from "@/components/maps/map-edit-link";
import { MapExportControl } from "@/components/maps/map-export-control";
import { MapRenameControl } from "@/components/maps/map-rename-control";
import { cn } from "@/lib/utils";
import type { MapSummary } from "@/lib/types/map";

/**
 * The map's tile, on a fixed light neutral rather than a theme surface: a
 * floor plan image has near-black walls in both themes, so a dark tile would
 * read as an empty rectangle. A hair lighter than the 205 unknown-grey so the
 * map's own unknown region still reads as map.
 */
function MapThumbnail({ map }: { map: MapSummary }) {
  if (!map.thumbnail) {
    return (
      <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 border-b border-hairline bg-elevated">
        <LayersIcon className="size-6 text-muted-foreground" aria-hidden />
        <span className="instrument-label text-muted-foreground">
          No preview
        </span>
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] border-b border-hairline bg-[#e4e4e4] p-2">
      {/* Plain <img>: apiUrl() resolves the host at runtime, which next/image's
       * build-time remotePatterns can't know. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={map.thumbnail}
        alt={`Floor plan of ${map.name}`}
        className="size-full object-contain"
      />
    </div>
  );
}

/**
 * The chip for a map's floor plan state, or nothing for a good one (a chip on
 * every healthy card would just say "fine"). Only `failed` is a fault (`warn`:
 * the same recipe will fail again); `none` and `interrupted` are not-done
 * (`caution`); `converting` is mid-action (`active`).
 */
function GridStatusChip({ map }: { map: MapSummary }) {
  switch (map.grid_status) {
    case "converting":
      return <Chip tone="active">Converting…</Chip>;
    case "failed":
      return (
        <Chip tone="warn" title={map.grid_error ?? undefined}>
          Conversion failed
        </Chip>
      );
    case "interrupted":
      return <Chip tone="caution">Build stopped</Chip>;
    case "none":
      return <Chip tone="caution">No floor plan</Chip>;
    default:
      return null;
  }
}

/**
 * What to do about a missing or stale floor plan — the actionable half of the
 * chip, beside the control that acts. Always shown, because a failed
 * conversion's reason is otherwise only in the robot's log.
 *
 * Silent for `ok` and `converting`, where the chip says it all. No branch may
 * name Build grid unless it is on the card: GridRebuildControl renders only
 * for a map with a scan.
 */
function GridStatusNote({ map }: { map: MapSummary }) {
  if (map.grid_status === "ok" || map.grid_status === "converting") return null;

  if (!map.has_pointcloud) {
    // No scan file, so nothing to convert from: re-saving the run is the only
    // way back, and the run is gone.
    return (
      <p className="mt-2 text-[11px] leading-tight text-signal-warn">
        This map has no scan data, so a floor plan cannot be built from it. Only
        a fresh mapping run can replace it.
      </p>
    );
  }

  if (map.grid_status === "failed") {
    return (
      <p className="mt-2 text-[11px] leading-tight text-signal-warn">
        {map.grid_error ??
          "The floor plan could not be built, and the robot did not record why."}{" "}
        <span className="text-muted-foreground">
          {map.grid
            ? "The map is still using the floor plan it had before. Try rebuilding it with the other setting."
            : "Rebuilding with the same setting will fail the same way — try the other one."}
        </span>
      </p>
    );
  }

  if (map.grid_status === "interrupted") {
    return (
      <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
        The robot restarted before the floor plan was finished, so it was never
        built. Rebuild it — the scan data is fine.
      </p>
    );
  }

  // "none" is last because it doubles as the fallback: an unknown status means
  // a newer backend, and "build one" is the safe thing to say.
  return (
    <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
      This map was saved but its floor plan was never built, so the robot cannot
      navigate with it yet. Build the floor plan to start using it.
    </p>
  );
}

/**
 * One map in the catalogue, in instrument vocabulary: `signal-cmd` marks the
 * loaded map, the console's hue for "the value in force".
 *
 * No readouts, by request — the screen answers "which maps are here and which
 * is loaded"; what a map measures is the editor's business. Always shown: "In
 * use", the floor plan chip and its note — a map the robot can't load must say
 * so at a glance, and a conversion in flight is why Edit and Rebuild are greyed.
 *
 * "In use" gets three signals so one card wins outright: a solid corner check,
 * a ring, and first place in the sort. `aria-current` carries it to a screen
 * reader.
 *
 * The title is the one editable value (MapRenameControl). Delete and Edit are
 * corner tiles (an X and a pencil) rather than words in the header, so the
 * destructive one doesn't read as another view. Rename and Delete grey on the
 * map in use — the stack was launched with that name, and the backend refuses
 * both. Edit doesn't (a floor plan saved onto the live map reloads in place)
 * and greys only while a job drives on it.
 */
export function MapCard({
  map,
  onRenamed,
  onDeleted,
  onSwitched,
}: {
  map: MapSummary;
  /** Forwarded to the rename control; see MapRenameControl. */
  onRenamed?: (message: string) => void;
  /** Same contract for delete — the card unmounts on success. */
  onDeleted?: (message: string) => void;
  /** The backend's sentence about where the robot ended up after a map switch. */
  onSwitched?: (message: string) => void;
}) {
  const grid = map.grid;

  return (
    <article
      aria-current={map.active ? "true" : undefined}
      className={cn(
        // `relative` pins the corner overlays; see MapDeleteControl.
        "relative overflow-hidden rounded-sm border",
        map.active
          ? // A ring plus the border reads as 2px without the reflow border-2
            // would cause on one card in the grid.
            "border-signal-cmd bg-signal-cmd/8 ring-1 ring-signal-cmd"
          : "border-hairline bg-panel",
      )}
    >
      {/* The in-use check, in the corner MapActivateControl takes on every
       * other card. A glyph so it reads as *which one*; the words survive as
       * tooltip and accessible name, since a check alone can't say "loaded"
       * vs "selected". bg-primary is signal-cmd in both themes. */}
      {map.active ? (
        <span
          title="In use — the map the robot is working in"
          aria-label="In use"
          className="absolute top-2 left-2 z-10 flex size-6 items-center justify-center rounded-sm bg-primary text-primary-foreground shadow-sm"
        >
          <CheckIcon className="size-3.5" aria-hidden />
        </span>
      ) : (
        // Same corner, opposite job: the action that moves the badge here.
        // Mutually exclusive with the badge — it renders nothing when active.
        <MapActivateControl map={map} onSwitched={onSwitched} />
      )}
      <MapDeleteControl map={map} onDeleted={onDeleted} />
      <MapEditLink map={map} />
      <MapThumbnail map={map} />

      <div className="px-3 py-3">
        <header className="flex items-center gap-2">
          <MapRenameControl map={map} onRenamed={onRenamed} />
        </header>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {map.has_pointcloud && (
            <Chip tone="neutral">
              <BoxIcon className="mr-1 size-3" aria-hidden />
              Point cloud
            </Chip>
          )}
          <GridStatusChip map={map} />

          {/* Export at the right: the one verb that takes a copy without
           * touching the map. Its refusal line is a `basis-full` child of this
           * wrapping row, so it lands under the chips. */}
          <MapExportControl map={map} />
        </div>

        {/* Why the floor plan is missing or stale, then the control that fixes
         * it, below the chips since both carry sentences. Only with a scan —
         * without one the backend would 400. */}
        <GridStatusNote map={map} />
        {map.has_pointcloud && <GridRebuildControl map={map} />}
      </div>
    </article>
  );
}
