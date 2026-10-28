import { describe, expect, it } from "vitest";

import { canEditMap, mapEditorHref, waypointEditor } from "@/lib/map/links";
import type { OctomapStatus } from "@/lib/types/map";

function map(octomap_status: OctomapStatus, name = "dp") {
  return { name, octomap_status };
}

/**
 * Every link that offers to place a map's waypoints goes through this rule.
 * A link into the editor for a map with no 3D map opens a page with nothing
 * to place them on.
 */
describe("waypointEditor", () => {
  it("opens the editor with Waypoint armed once the 3D map is built", () => {
    expect(waypointEditor(map("ok"))).toEqual({ href: "/maps/dp/edit?tool=waypoint" });
  });

  it("offers nothing while the 3D map is unfinished", () => {
    for (const status of ["none", "converting", "failed", "interrupted"] as const) {
      expect(waypointEditor(map(status)), status).toBeNull();
    }
  });

  it("carries the way back to the task editor", () => {
    expect(waypointEditor(map("ok"), { from: "tasks" })?.href).toBe(
      "/maps/dp/edit?tool=waypoint&from=tasks",
    );
  });

  it("encodes the map's name into the path", () => {
    expect(waypointEditor(map("ok", "a b"))?.href).toBe("/maps/a%20b/edit?tool=waypoint");
  });
});

describe("canEditMap", () => {
  it("opens only a map whose 3D map the robot has finished", () => {
    expect(canEditMap(map("ok"))).toBe(true);
    for (const status of ["none", "converting", "failed", "interrupted"] as const) {
      expect(canEditMap(map(status)), status).toBe(false);
    }
  });
});

describe("mapEditorHref", () => {
  it("is the bare editor when nothing is asked of it", () => {
    expect(mapEditorHref("dp")).toBe("/maps/dp/edit");
  });

  it("keeps the way back", () => {
    expect(mapEditorHref("dp", { from: "tasks" })).toBe("/maps/dp/edit?from=tasks");
  });
});
