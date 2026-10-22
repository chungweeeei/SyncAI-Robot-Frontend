"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";

import { Segmented } from "@/components/console/instrument";
import { Map3dEditor } from "@/components/maps/map-3d-editor";
import { MapGridEditor } from "@/components/maps/map-grid-editor";
import { MapTitleRename } from "@/components/maps/map-title-rename";
import { useMaps } from "@/hooks/use-maps";
import type { EditMode } from "@/lib/map/editor";
import {
  editorViews,
  mapEditorHref,
  type MapEditorView,
  type MapLinkFrom,
} from "@/lib/map/links";

const VIEW_OPTIONS = [
  { value: "2d", label: "2D" },
  { value: "3d", label: "3D" },
] as const satisfies readonly { value: MapEditorView; label: string }[];

const subscribeNoop = () => () => {};

const LEAVE_PROMPT = "Leave the editor? Your unsaved changes to this map will be lost.";
const SWITCH_PROMPT: Record<MapEditorView, string> = {
  "2d": "Switch to the floor plan? Your unsaved ground patches will be lost.",
  "3d": "Switch to the 3D view? Your unsaved changes to this map will be lost.",
};

/**
 * A map's editor: its floor plan (MapGridEditor) or its 3D map with the
 * waypoints on it (Map3dEditor), on one page, with a 2D / 3D switch in the
 * header for a map that has both. The view lives in the URL, so a link can
 * land in either and Back returns to where the link came from.
 */
export function MapEditor({
  name,
  view,
  initialMode,
  openOnWaypoint,
  from,
}: {
  name: string;
  view: MapEditorView;
  /** The floor plan view's opening mode. */
  initialMode: EditMode;
  /** Open the 3D view with Waypoint armed. */
  openOnWaypoint: boolean;
  from: MapLinkFrom | null;
}) {
  const router = useRouter();
  const { maps } = useMaps();
  // The status strip reads the catalogue too, so it can be in the cache
  // before this boundary hydrates; read before mount, it would put a switch
  // into the first render that the server's had no catalogue to draw.
  const mounted = React.useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
  const entry = mounted ? (maps?.find((map) => map.name === name) ?? null) : null;
  const views = entry ? editorViews(entry) : [];
  // The view comes from the URL alone, never from the catalogue: a
  // conversion started elsewhere drops the floor plan from editorViews, and
  // must not pull an open one out from under its strokes. The view shown is
  // always offered too, so a link into a view the map lacks still has the
  // switch out of its guard.
  const offered = views.includes(view) ? views : [...views, view];

  /**
   * Mirrored out of whichever view is open — the floor plan's strokes,
   * zones and staged waypoints, or the 3D view's ground patches (its
   * waypoints are written as they are placed): the App Router has no
   * navigation blocker, so Back and the switch have to ask themselves, and
   * the title's rename navigates too (see MapTitleRename).
   */
  const [dirty, setDirty] = React.useState(false);
  const returnTo = from === "tasks" ? "/tasks/editor" : "/maps";

  const goBack = () => {
    if (dirty && !window.confirm(LEAVE_PROMPT)) return;
    router.push(returnTo);
  };

  const switchView = (next: MapEditorView) => {
    if (next === view) return;
    if (dirty && !window.confirm(SWITCH_PROMPT[next])) return;
    setDirty(false);
    // replace, not push: the two views are one screen, and the browser's
    // Back should leave it rather than flip between them.
    router.replace(mapEditorHref(name, next, { from: from ?? undefined }));
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
        {offered.length > 1 ? (
          <Segmented
            label="View"
            value={view}
            options={VIEW_OPTIONS}
            onChange={switchView}
            className="shrink-0"
          />
        ) : view === "3d" ? (
          <span className="instrument-label text-muted-foreground">3D map</span>
        ) : null}
      </header>

      <div className="min-h-0 flex-1">
        {view === "3d" ? (
          <Map3dEditor name={name} openOnWaypoint={openOnWaypoint} onDirtyChange={setDirty} />
        ) : (
          <MapGridEditor name={name} initialMode={initialMode} onDirtyChange={setDirty} />
        )}
      </div>
    </div>
  );
}
