"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";

import { MapEditor } from "@/components/maps/map-editor";

/**
 * A map's editor, its floor plan or its 3D map. Chrome only — MapEditor
 * owns the header and the switch; each view owns its editing. The
 * canvases size from their container, so the editor gives them a definite
 * height; the page does not scroll.
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
 * `view=3d` opens the 3D view (without it, the floor plan, as this route
 * always has), `mode=vertex` the floor plan's Waypoints mode,
 * `tool=waypoint` the 3D view's Waypoint tool, and `from=tasks` points Back
 * at the task editor; all are written by lib/map/links.ts.
 */
function MapEditScreen() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();

  return (
    <MapEditor
      name={params.name}
      view={search.get("view") === "3d" ? "3d" : "2d"}
      initialMode={search.get("mode") === "vertex" ? "vertex" : "grid"}
      openOnWaypoint={search.get("tool") === "waypoint"}
      from={search.get("from") === "tasks" ? "tasks" : null}
    />
  );
}
