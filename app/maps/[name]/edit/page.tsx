"use client";

import * as React from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { MapGridEditor } from "@/components/maps/map-grid-editor";
import { MapTitleRename } from "@/components/maps/map-title-rename";

/**
 * The gridmap editor.
 *
 * Replaces a step that was being done in GIMP: `map/dp2f/gridmap.pgm` on the robot
 * carries ~30 000 hand-painted white cells and a `gridmap_raw.pgm` backup beside it.
 *
 * Chrome only — MapGridEditor owns the editing. The canvas sizes itself from its
 * container, so this column has to give it a definite height (`min-h-0` + `flex-1`)
 * rather than letting `h-full` resolve against nothing. The shell's <main> does not
 * scroll and neither does this page.
 */
export default function MapEditPage() {
  return (
    // The query readers below suspend during a static prerender, and Next
    // insists on a boundary around them (see its useSearchParams docs); the
    // fallback is the whole page a beat later, which is what it was anyway.
    <React.Suspense fallback={null}>
      <MapEditScreen />
    </React.Suspense>
  );
}

/**
 * The query this page reads, and who writes it.
 *
 * `mode=vertex` opens the editor in Waypoints mode, and `from=tasks` turns the
 * back button into a way back to the task editor: both are set by
 * `waypointEditorHref` in lib/map/links.ts, for the operator who noticed
 * mid-job that a stop was missing. Anything else falls back to the defaults
 * this page always had.
 */
function MapEditScreen() {
  const params = useParams<{ name: string }>();
  const router = useRouter();
  const search = useSearchParams();
  const name = params.name;
  const initialMode = search.get("mode") === "vertex" ? "vertex" : "grid";
  const returnTo = search.get("from") === "tasks" ? "/tasks" : "/maps";

  /**
   * Mirrored out of the editor for two reasons. The App Router has no navigation
   * blocker, so `beforeunload` in the editor catches a reload or a tab close but
   * cannot see a client-side navigation, and the back button is the one in-app
   * exit from this screen, so it has to ask. The title's rename needs the same
   * bit for a related reason — it navigates, and what it navigates to reloads
   * the grid; see MapTitleRename.
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
          aria-label={returnTo === "/tasks" ? "Back to tasks" : "Back to maps"}
          title={returnTo === "/tasks" ? "Back to the task editor" : "Back to maps"}
          className="flex size-7 shrink-0 items-center justify-center rounded-sm border border-hairline text-muted-foreground transition-colors hover:bg-elevated hover:text-foreground"
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
