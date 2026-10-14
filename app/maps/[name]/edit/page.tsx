"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { MapGridEditor } from "@/components/maps/map-grid-editor";
import { MapTitleRename } from "@/components/maps/map-title-rename";

/**
 * The floor plan editor. Chrome only — MapGridEditor owns the editing. The
 * canvas sizes from its container, so this column gives it a definite height
 * (`min-h-0` + `flex-1`); the page does not scroll.
 */
export default function MapEditPage() {
  return (
    // useSearchParams suspends during a static prerender and Next requires a
    // boundary around it.
    <React.Suspense fallback={null}>
      <MapEditScreen />
    </React.Suspense>
  );
}

/**
 * `mode=vertex` opens Waypoints mode and `from=tasks` points Back at the task
 * editor; both are written by `waypointEditorHref` in lib/map/links.ts.
 */
function MapEditScreen() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const name = params.name;
  const initialMode = search.get("mode") === "vertex" ? "vertex" : "grid";
  const returnTo = search.get("from") === "tasks" ? "/tasks/editor" : "/maps";

  /**
   * Mirrored out of the editor: the App Router has no navigation blocker, so
   * the back button has to ask itself, and the title's rename navigates too
   * (see MapTitleRename).
   */
  const [dirty, setDirty] = React.useState(false);

  const goBack = () => {
    if (
      dirty &&
      !window.confirm("Leave the editor? Your unsaved changes to this map will be lost.")
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
        <MapTitleRename name={name} dirty={dirty} />
      </header>

      <div className="min-h-0 flex-1">
        <MapGridEditor name={name} initialMode={initialMode} onDirtyChange={setDirty} />
      </div>
    </div>
  );
}
