"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Map3dEditor } from "@/components/maps/map-3d-editor";
import { MapTitleRename } from "@/components/maps/map-title-rename";

/**
 * The 3D map's page (/maps/[name]/3d): chrome only, like the floor plan
 * editor's. Map3dEditor owns the waypoints; this column gives its canvas a
 * definite height.
 */
export default function Map3dPage() {
  return (
    // useSearchParams suspends during a static prerender and Next requires a
    // boundary around it.
    <React.Suspense fallback={null}>
      <Map3dScreen />
    </React.Suspense>
  );
}

/**
 * `tool=waypoint` opens with the Waypoint tool armed and `from=tasks` points
 * Back at the task editor; both are written by `map3dHref` in lib/map/links.ts.
 */
function Map3dScreen() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const name = params.name;
  const openOnWaypoint = search.get("tool") === "waypoint";
  const returnTo = search.get("from") === "tasks" ? "/tasks/editor" : "/maps";

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-hairline px-4 py-2.5">
        <button
          type="button"
          onClick={() => router.push(returnTo)}
          aria-label={returnTo === "/tasks/editor" ? "Back to tasks" : "Back to maps"}
          title={returnTo === "/tasks/editor" ? "Back to the task editor" : "Back to maps"}
          className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-hairline text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground pointer-coarse:size-10"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
        </button>
        <MapTitleRename name={name} dirty={false} page="3d" />
        <span className="instrument-label text-muted-foreground">3D map</span>
      </header>

      <div className="min-h-0 flex-1">
        <Map3dEditor name={name} openOnWaypoint={openOnWaypoint} />
      </div>
    </div>
  );
}
