"use client";

import * as React from "react";

import { Notice } from "@/components/console/notice";
import { MapCard } from "@/components/maps/map-card";
import { MapImportControl } from "@/components/maps/map-import-control";
import { Skeleton } from "@/components/ui/skeleton";
import { useMaps } from "@/hooks/use-maps";

// More cards per row as the window widens, up to four — still wide enough
// for a card's chips and Export on one line.
const GRID = "grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
 * The header (the page's title, handed in as `heading`, with Import on its
 * row as every screen's action is) and that line render in every state: a
 * robot with no maps is the one someone is bringing an archive to. Import is
 * drawn here rather than by the page because its sentence lands on that line.
 */
export function MapLibrary({ heading }: { heading: React.ReactNode }) {
  const { maps, status } = useMaps();
  const [lastResult, setLastResult] = React.useState<string | null>(null);

  // One line for every map control's sentence; the latest is the one worth
  // reading.
  const toolbar = (
    <>
      <header className="mb-6 flex items-start justify-between gap-3">
        <div className="min-w-0">{heading}</div>
        <MapImportControl maps={maps} onResult={setLastResult} />
      </header>
      {lastResult && (
        <p role="status" className="mb-3 text-[11px] leading-tight text-muted-foreground">
          {lastResult}
        </p>
      )}
    </>
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
