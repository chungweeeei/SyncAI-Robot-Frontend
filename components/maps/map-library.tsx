"use client";

import * as React from "react";

import { MapCard } from "@/components/maps/map-card";
import { MapImportControl } from "@/components/maps/map-import-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useMaps } from "@/hooks/use-maps";

const GRID = "grid gap-4 sm:grid-cols-2 xl:grid-cols-3";

/** Same panel shape /settings uses when a state frame has not arrived. */
function Notice({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border border-hairline bg-panel p-4">
      <p className="instrument-label text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm">{children}</p>
    </div>
  );
}

function LoadingGrid() {
  return (
    <div className={GRID} aria-busy>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="overflow-hidden rounded-sm border border-hairline bg-panel"
        >
          <Skeleton className="aspect-[4/3] rounded-none" />
          <div className="space-y-2 px-3 py-3">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The map catalogue: what is on the robot, and which map it is running on.
 *
 * That last fact used to come with a caveat this page had to spell out, because
 * the choice was made in the instance INI and taking effect meant restarting the
 * stack. It no longer does — the card's Switch control re-points the running
 * localizer and map_server and rewrites the INI in one call.
 *
 * Renaming, deleting and switching are calls: each card carries all three
 * controls, and the backend's sentence about any of them is held *here*. For a
 * rename or a delete that is because the card is keyed by its name and both
 * outcomes unmount it with the refetch. A switch leaves its card mounted, but
 * its sentence is about the *robot* — where it ended up, and whether it still
 * needs an initial pose — so it belongs above the grid rather than inside the
 * card of a map that is now merely one of several. An import's sentence lands
 * on the same line for the first reason: the card it is about does not exist
 * until the refetch mounts it.
 *
 * The toolbar — that line and the Import button — renders in every state,
 * including "no maps" and "unavailable". A robot with no maps is exactly the
 * one an operator is bringing an archive to, and hiding the only way in behind
 * the empty state would make the state permanent.
 */
export function MapLibrary() {
  const { maps, status } = useMaps();
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  // The backend's sentence, verbatim — same contract as the other map
  // controls. It says how many vertices and templates followed the name, how
  // many went with the deleted map, or what an import brought, which no card
  // is around to show. One line for all of them: they are the same kind of
  // answer, and the latest to arrive is the one worth reading.
  const toolbar = (
    <div className="mb-3 flex items-start gap-3">
      {lastResult && (
        <p
          role="status"
          className="min-w-0 flex-1 pt-1 text-[11px] leading-tight text-muted-foreground"
        >
          {lastResult}
        </p>
      )}
      <div className="ml-auto shrink-0">
        <MapImportControl maps={maps} onImported={setLastResult} />
      </div>
    </div>
  );

  if (!maps) {
    return (
      <div>
        {toolbar}
        {status === "error" ? (
          <Notice label="Maps unavailable">
            The robot&apos;s map list could not be read.
          </Notice>
        ) : (
          <LoadingGrid />
        )}
      </div>
    );
  }

  if (maps.length === 0) {
    return (
      <div>
        {toolbar}
        <Notice label="No maps">
          This robot has no saved maps. They are written to{" "}
          <span className="readout">map/&lt;name&gt;/</span> when a mapping run
          is saved, and Import brings one over from another robot.
        </Notice>
      </div>
    );
  }

  // Loaded map first — it is the one an operator is looking for — then by name.
  const ordered = [...maps].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <div>
      {toolbar}
      <div className={GRID}>
        {ordered.map((map) => (
          <MapCard
            key={map.name}
            map={map}
            onRenamed={setLastResult}
            onDeleted={setLastResult}
            onSwitched={setLastResult}
          />
        ))}
      </div>
    </div>
  );
}
