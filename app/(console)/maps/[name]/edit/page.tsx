"use client";

import * as React from "react";
import { useParams, useSearchParams } from "next/navigation";

import { MapEditor } from "@/components/maps/map-editor";

/**
 * A map's editor, on its 3D map. Chrome only — MapEditor owns the header,
 * Map3dEditor the editing. The canvas sizes from its container, so the
 * editor gives it a definite height; the page does not scroll.
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
 * `tool=waypoint` arms the Waypoint tool and `from=tasks` points Back at the
 * task editor; both are written by lib/map/links.ts. A `view` left in an old
 * link is ignored.
 */
function MapEditScreen() {
  const params = useParams<{ name: string }>();
  const search = useSearchParams();

  return (
    <MapEditor
      name={params.name}
      openOnWaypoint={search.get("tool") === "waypoint"}
      from={search.get("from") === "tasks" ? "tasks" : null}
    />
  );
}
