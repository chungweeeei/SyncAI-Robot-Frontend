"use client";

import { CheckIcon, LayersIcon } from "lucide-react";

import { Chip } from "@/components/console/instrument";
import { MapActivateControl } from "@/components/maps/map-activate-control";
import { MapDeleteControl } from "@/components/maps/map-delete-control";
import { MapEditLink } from "@/components/maps/map-edit-link";
import { MapExportControl } from "@/components/maps/map-export-control";
import { MapRenameControl } from "@/components/maps/map-rename-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useInView } from "@/hooks/use-in-view";
import { useMapOctomapPreview } from "@/hooks/use-map-octomap-preview";
import { cn } from "@/lib/utils";
import type { MapSummary } from "@/lib/types/map";

/**
 * The map's tile: its 3D map, drawn in the browser (useMapOctomapPreview) once
 * the card nears the screen, so a long list downloads only the trees an
 * operator scrolls to; while it is drawn the tile pulses. A map with no 3D
 * map yet, or one that cannot be read, gets a placeholder that says so.
 *
 * On a fixed light neutral rather than a theme surface, so the still's
 * height colours read the same in both themes.
 */
function MapTile({ map }: { map: MapSummary }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const has3d = map.octomap_status === "ok";
  const preview = useMapOctomapPreview(has3d && inView ? map.name : null);

  if (has3d && preview.status !== "error") {
    if (!preview.url) {
      return (
        <div ref={ref} className="aspect-[4/3] border-b border-hairline">
          <Skeleton className="size-full rounded-none" />
          <span className="sr-only">Drawing the 3D map of {map.name}</span>
        </div>
      );
    }
    return (
      <div className="aspect-[4/3] border-b border-hairline bg-[#e4e4e4]">
        {/* A data URL drawn here, so next/image has nothing to optimise. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={preview.url}
          alt={`3D map of ${map.name}`}
          className="size-full object-contain"
        />
      </div>
    );
  }

  return (
    <div className="flex aspect-[4/3] flex-col items-center justify-center gap-2 border-b border-hairline bg-elevated">
      <LayersIcon className="size-6 text-muted-foreground" aria-hidden />
      <span className="instrument-label text-muted-foreground">
        {has3d ? "No preview" : "No 3D map"}
      </span>
    </div>
  );
}

/**
 * The chip for a map's 3D map while it is not simply there: being built is
 * mid-action (`active`), a failed build a fault (`warn`), an interrupted one
 * not-done (`caution`), and none at all is said in neutral. A built one needs
 * no chip — the tile shows it. An unknown status from a newer backend reads
 * as none.
 */
function OctomapStatusChip({ map }: { map: MapSummary }) {
  switch (map.octomap_status) {
    case "ok":
      return null;
    case "converting":
      return <Chip tone="active">Building 3D map…</Chip>;
    case "failed":
      return (
        <Chip tone="warn" title={map.octomap_error ?? undefined}>
          3D map failed
        </Chip>
      );
    case "interrupted":
      return <Chip tone="caution">3D map stopped</Chip>;
    default:
      return <Chip tone="neutral">No 3D map</Chip>;
  }
}

/**
 * Why a map's 3D map is missing — the half the chip cannot say. Always
 * shown, because a failed build's reason is otherwise only in the robot's
 * log. Silent for `ok`, `converting` and `none`, where the chip says it all.
 */
function OctomapStatusNote({ map }: { map: MapSummary }) {
  if (map.octomap_status === "failed") {
    return (
      <p className="mt-2 text-[11px] leading-tight text-signal-warn">
        {map.octomap_error ??
          "The 3D map could not be built, and the robot did not record why."}
      </p>
    );
  }

  if (map.octomap_status === "interrupted") {
    return (
      <p className="mt-2 text-[11px] leading-tight text-muted-foreground">
        The robot stopped before the 3D map was finished, so it was never
        built. The scan data is fine.
      </p>
    );
  }

  return null;
}

/**
 * One map in the catalogue, in instrument vocabulary: `signal-cmd` marks the
 * loaded map, the console's hue for "the value in force".
 *
 * No readouts, by request — the screen answers "which maps are here and which
 * is loaded"; what a map measures is the editor's business. Always shown: "In
 * use", the 3D map chip and its note — a map the robot can't load must say so
 * at a glance, and a build in flight is why Edit may be greyed.
 *
 * "In use" gets three signals so one card wins outright: a solid corner check,
 * a ring, and first place in the sort. `aria-current` carries it to a screen
 * reader.
 *
 * The title is the one editable value (MapRenameControl). Delete and Edit are
 * corner tiles (an X and a pencil) rather than words in the header, so the
 * destructive one doesn't read as another view. Rename and Delete grey on the
 * map in use — the stack was launched with that name, and the backend refuses
 * both. Edit doesn't (zones saved onto the live map reload in place) and
 * greys only while a job drives on it.
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
      <MapTile map={map} />

      <div className="px-3 py-3">
        <header className="flex items-center gap-2">
          <MapRenameControl map={map} onRenamed={onRenamed} />
        </header>

        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <OctomapStatusChip map={map} />

          {/* Export at the right: the one verb that takes a copy without
           * touching the map. Its refusal line is a `basis-full` child of this
           * wrapping row, so it lands under the chips. */}
          <MapExportControl map={map} />
        </div>

        {/* Why the 3D map is missing, below the chips since it carries
         * sentences. */}
        <OctomapStatusNote map={map} />
      </div>
    </article>
  );
}
