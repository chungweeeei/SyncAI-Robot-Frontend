import { describe, expect, it } from "vitest";

import {
  SWITCH_BUILDING_3D,
  SWITCH_NO_MAP,
  SWITCH_NO_SCAN,
  switchRefusal,
} from "@/lib/map/switch";
import type { OctomapStatus } from "@/lib/types/map";

function map(octomap_status: OctomapStatus, has_pointcloud = true) {
  return { octomap_status, has_pointcloud };
}

/**
 * Which maps the robot may be switched onto. The backend's rule is a built
 * 3D map, so a refusal here that the backend would not make is a map the
 * operator cannot use for no reason, and a switch offered that it refuses is
 * a button that only ever answers 409.
 */
describe("switchRefusal", () => {
  it("lets a map with a 3D map be switched to", () => {
    expect(switchRefusal(map("ok"))).toBeNull();
  });

  it("holds a map with no scan, since the robot could not find itself on it", () => {
    expect(switchRefusal(map("ok", false))).toBe(SWITCH_NO_SCAN);
  });

  it("asks for a 3D map still being built to be waited for", () => {
    expect(switchRefusal(map("converting"))).toBe(SWITCH_BUILDING_3D);
  });

  it("holds a map with no 3D map", () => {
    expect(switchRefusal(map("none"))).toBe(SWITCH_NO_MAP);
    expect(switchRefusal(map("failed"))).toBe(SWITCH_NO_MAP);
    expect(switchRefusal(map("interrupted"))).toBe(SWITCH_NO_MAP);
  });
});
