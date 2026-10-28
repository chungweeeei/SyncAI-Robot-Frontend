"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Map3dEditor } from "@/components/maps/map-3d-editor";
import { MapTitleRename } from "@/components/maps/map-title-rename";
import type { MapLinkFrom } from "@/lib/map/links";

const LEAVE_PROMPT = "Leave the editor? Your unsaved changes to this map will be lost.";

/**
 * A map's editor: its 3D map with the waypoints, forbidden zones and ground
 * patches on it (Map3dEditor), under a header with the way back and the
 * map's name. Back returns to where the link came from.
 */
export function MapEditor({
  name,
  openOnWaypoint,
  from,
}: {
  name: string;
  /** Open with Waypoint armed. */
  openOnWaypoint: boolean;
  from: MapLinkFrom | null;
}) {
  const router = useRouter();

  /**
   * Mirrored out of the editor — its ground patches and zones (its waypoints
   * are written as they are placed): the App Router has no navigation
   * blocker, so Back has to ask itself, and the title's rename navigates too
   * (see MapTitleRename).
   */
  const [dirty, setDirty] = React.useState(false);
  const returnTo = from === "tasks" ? "/tasks/editor" : "/maps";

  const goBack = () => {
    if (dirty && !window.confirm(LEAVE_PROMPT)) return;
    router.push(returnTo);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
        <button
          type="button"
          onClick={goBack}
          aria-label={returnTo === "/tasks/editor" ? "Back to tasks" : "Back to maps"}
          title={returnTo === "/tasks/editor" ? "Back to the task editor" : "Back to maps"}
          className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-hairline text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
        </button>
        <MapTitleRename name={name} dirty={dirty} />
        <span className="instrument-label shrink-0 text-muted-foreground">3D map</span>
      </header>

      <div className="min-h-0 flex-1">
        <Map3dEditor name={name} openOnWaypoint={openOnWaypoint} onDirtyChange={setDirty} />
      </div>
    </div>
  );
}
