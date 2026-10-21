"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { GroundEditor } from "@/components/maps/ground-editor";
import { MapTitleRename } from "@/components/maps/map-title-rename";

/**
 * The 3D map's page (/maps/[name]/3d): chrome only, like the floor plan
 * editor's.
 * GroundEditor owns the editing; this column gives its canvas a definite
 * height and the back button its unsaved-changes question.
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
  const [dirty, setDirty] = React.useState(false);

  const goBack = () => {
    if (
      dirty &&
      !window.confirm("Leave the editor? Your unsaved ground patches will be lost.")
    ) {
      return;
    }
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
        <MapTitleRename name={name} dirty={dirty} page="3d" />
        <span className="instrument-label text-muted-foreground">3D map</span>
      </header>

      <div className="min-h-0 flex-1">
        <GroundEditor name={name} openOnWaypoint={openOnWaypoint} onDirtyChange={setDirty} />
      </div>
    </div>
  );
}
