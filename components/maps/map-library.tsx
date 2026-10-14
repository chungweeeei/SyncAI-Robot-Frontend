"use client";

import * as React from "react";

import { MapCard } from "@/components/maps/map-card";
import { MapImportControl } from "@/components/maps/map-import-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useMaps } from "@/hooks/use-maps";

// More cards per row as the window widens, up to four — still wide enough
// for a card's chips and Export on one line.
const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

/** The empty / failed panel /settings uses. */
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
 * The map catalogue: what is on the robot, and which map it runs on.
 *
 * The backend's sentence for a rename, delete, switch or import is held here:
 * rename and delete unmount their card, an import's card doesn't exist yet,
 * and a switch's sentence is about the robot (where it is, whether it needs a
 * pose), not one card.
 *
 * The toolbar (that line and Import) renders in every state: a robot with no
 * maps is the one someone is bringing an archive to.
 */
export function MapLibrary() {
  const { maps, status } = useMaps();
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  // One line for every map control's sentence; the latest is the one worth
  // reading.
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
        <MapImportControl maps={maps} onResult={setLastResult} />
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

  // Loaded map first, then by name.
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
