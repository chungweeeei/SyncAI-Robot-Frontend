import { describe, expect, it } from "vitest";

import { map3dHref, waypointEditor } from "@/lib/map/links";
import type { GridStatus } from "@/lib/types/map";
import type { MapMetadata } from "@/lib/types/robot";

const GRID: MapMetadata = {
  resolution: 0.05,
  origin: [0, 0, 0],
  width: 10,
  height: 10,
};

function map(grid: MapMetadata | null, octomap_status: GridStatus, name = "dp") {
  return { name, grid, octomap_status };
}

/**
 * Every link that offers to place a map's waypoints goes through this rule.
 * A link to the floor plan editor on a map with no floor plan opens a page
 * that cannot load, which is how a scan-and-3D-map save had no way in.
 */
describe("waypointEditor", () => {
  it("opens the floor plan editor in Waypoints mode when there is a floor plan", () => {
    expect(waypointEditor(map(GRID, "none"))).toEqual({
      surface: "floor plan",
      href: "/maps/dp/edit?mode=vertex",
    });
  });

  it("prefers the floor plan on a map that also has a 3D map", () => {
    expect(waypointEditor(map(GRID, "ok"))?.surface).toBe("floor plan");
  });

  it("opens the 3D map page with Waypoint armed when there is no floor plan", () => {
    expect(waypointEditor(map(null, "ok"))).toEqual({
      surface: "3D map",
      href: "/maps/dp/3d?tool=waypoint",
    });
  });

  it("offers nothing while the 3D map is unfinished and there is no floor plan", () => {
    for (const status of ["none", "converting", "failed", "interrupted"] as const) {
      expect(waypointEditor(map(null, status)), status).toBeNull();
    }
  });

  it("carries the way back to the task editor on either page", () => {
    expect(waypointEditor(map(GRID, "none"), { from: "tasks" })?.href).toBe(
      "/maps/dp/edit?mode=vertex&from=tasks",
    );
    expect(waypointEditor(map(null, "ok"), { from: "tasks" })?.href).toBe(
      "/maps/dp/3d?tool=waypoint&from=tasks",
    );
  });

  it("encodes the map's name into the path", () => {
    expect(waypointEditor(map(null, "ok", "a b"))?.href).toBe("/maps/a%20b/3d?tool=waypoint");
  });
});

describe("map3dHref", () => {
  it("is the bare page when nothing is asked of it", () => {
    expect(map3dHref("dp")).toBe("/maps/dp/3d");
  });
});
