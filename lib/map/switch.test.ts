import { describe, expect, it } from "vitest";

import {
  SWITCH_BUILDING_3D,
  SWITCH_CONVERTING,
  SWITCH_NO_MAP,
  SWITCH_NO_SCAN,
  switchRefusal,
} from "@/lib/map/switch";
import type { GridStatus } from "@/lib/types/map";

function map(
  grid_status: GridStatus,
  octomap_status: GridStatus,
  has_pointcloud = true,
) {
  return { grid_status, octomap_status, has_pointcloud };
}

/**
 * Which maps the robot may be switched onto. The backend's rule is a floor
 * plan or a 3D map, so a refusal here that the backend would not make is a
 * map the operator cannot use for no reason.
 */
describe("switchRefusal", () => {
  it("lets a map with a floor plan be switched to", () => {
    expect(switchRefusal(map("ok", "none"))).toBeNull();
  });

  it("lets a map with a 3D map and no floor plan be switched to", () => {
    expect(switchRefusal(map("none", "ok"))).toBeNull();
    expect(switchRefusal(map("failed", "ok"))).toBeNull();
  });

  it("lets a map with both be switched to", () => {
    expect(switchRefusal(map("ok", "ok"))).toBeNull();
  });

  it("holds a map whose floor plan is being rebuilt, 3D map or not", () => {
    expect(switchRefusal(map("converting", "ok"))).toBe(SWITCH_CONVERTING);
    expect(switchRefusal(map("converting", "none"))).toBe(SWITCH_CONVERTING);
  });

  it("holds a map with no scan, since the robot could not find itself on it", () => {
    expect(switchRefusal(map("ok", "ok", false))).toBe(SWITCH_NO_SCAN);
  });

  it("asks for a 3D map still being built to be waited for, not built", () => {
    expect(switchRefusal(map("none", "converting"))).toBe(SWITCH_BUILDING_3D);
  });

  it("holds a map with neither a floor plan nor a 3D map", () => {
    expect(switchRefusal(map("none", "none"))).toBe(SWITCH_NO_MAP);
    expect(switchRefusal(map("failed", "failed"))).toBe(SWITCH_NO_MAP);
    expect(switchRefusal(map("none", "interrupted"))).toBe(SWITCH_NO_MAP);
  });
});
