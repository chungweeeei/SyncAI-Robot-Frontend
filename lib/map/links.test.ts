import { describe, expect, it } from "vitest";

import { editorViews, map3dHref, mapEditorHref, waypointEditor } from "@/lib/map/links";
import type { GridStatus } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

const GRID: MapMetadata = {
  resolution: 0.05,
  origin: [0, 0, 0],
  width: 10,
  height: 10,
};

function map(
  grid: MapMetadata | null,
  octomap_status: GridStatus,
  name = "dp",
  grid_status: GridStatus = grid ? "ok" : "none",
) {
  return { name, grid, grid_status, octomap_status };
}

/**
 * Every link that offers to place a map's waypoints goes through this rule.
 * A link to the floor plan view on a map with no floor plan opens a page
 * that cannot load, which is how a scan-and-3D-map save had no way in.
 */
describe("waypointEditor", () => {
  it("opens the floor plan view in Waypoints mode when there is a floor plan", () => {
    expect(waypointEditor(map(GRID, "none"))).toEqual({
      surface: "floor plan",
      href: "/maps/dp/edit?mode=vertex",
    });
  });

  it("prefers the floor plan on a map that also has a 3D map", () => {
    expect(waypointEditor(map(GRID, "ok"))?.surface).toBe("floor plan");
  });

  it("opens the 3D view with Waypoint armed when there is no floor plan", () => {
    expect(waypointEditor(map(null, "ok"))).toEqual({
      surface: "3D map",
      href: "/maps/dp/edit?view=3d&tool=waypoint",
    });
  });

  it("offers nothing while the 3D map is unfinished and there is no floor plan", () => {
    for (const status of ["none", "converting", "failed", "interrupted"] as const) {
      expect(waypointEditor(map(null, status)), status).toBeNull();
    }
  });

  it("carries the way back to the task editor in either view", () => {
    expect(waypointEditor(map(GRID, "none"), { from: "tasks" })?.href).toBe(
      "/maps/dp/edit?mode=vertex&from=tasks",
    );
    expect(waypointEditor(map(null, "ok"), { from: "tasks" })?.href).toBe(
      "/maps/dp/edit?view=3d&tool=waypoint&from=tasks",
    );
  });

  it("encodes the map's name into the path", () => {
    expect(waypointEditor(map(null, "ok", "a b"))?.href).toBe(
      "/maps/a%20b/edit?view=3d&tool=waypoint",
    );
  });
});

/**
 * One editor page for both views: which of them a map has decides what its
 * pencil opens and whether the page offers the switch.
 */
describe("editorViews", () => {
  it("offers the floor plan first, so a map with both opens on it", () => {
    expect(editorViews(map(GRID, "ok"))).toEqual(["2d", "3d"]);
    expect(editorViews(map(GRID, "none"))).toEqual(["2d"]);
    expect(editorViews(map(null, "ok"))).toEqual(["3d"]);
  });

  it("offers a 3D map only once the robot has finished it", () => {
    for (const status of ["converting", "failed", "interrupted"] as const) {
      expect(editorViews(map(GRID, status)), status).toEqual(["2d"]);
    }
  });

  it("holds the floor plan back mid-conversion, but not after a failed one", () => {
    expect(editorViews(map(GRID, "ok", "dp", "converting"))).toEqual(["3d"]);
    expect(editorViews(map(GRID, "none", "dp", "converting"))).toEqual([]);
    expect(editorViews(map(GRID, "none", "dp", "failed"))).toEqual(["2d"]);
  });

  it("has nothing to offer a map with neither", () => {
    expect(editorViews(map(null, "none"))).toEqual([]);
  });
});

describe("mapEditorHref", () => {
  it("is the bare editor for the floor plan, and names the 3D view", () => {
    expect(mapEditorHref("dp", "2d")).toBe("/maps/dp/edit");
    expect(mapEditorHref("dp", "3d")).toBe("/maps/dp/edit?view=3d");
  });

  it("keeps the way back in either view", () => {
    expect(mapEditorHref("dp", "2d", { from: "tasks" })).toBe("/maps/dp/edit?from=tasks");
    expect(mapEditorHref("dp", "3d", { from: "tasks" })).toBe("/maps/dp/edit?view=3d&from=tasks");
  });
});

describe("map3dHref", () => {
  it("is the bare 3D view when nothing is asked of it", () => {
    expect(map3dHref("dp")).toBe("/maps/dp/edit?view=3d");
  });
});
