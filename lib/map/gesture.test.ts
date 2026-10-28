import { describe, expect, it } from "vitest";

import { DRAG_DEADZONE_PX, headingDegrees, isDrag } from "@/lib/map/gesture";

/**
 * The rules a press on a canvas has to keep. Each is something an operator
 * feels: a tap that turns into a drag, a click that snaps a waypoint's
 * heading to 0°.
 */

describe("isDrag", () => {
  it("is a click inside the deadzone and a drag at its edge", () => {
    expect(isDrag(0, 0, DRAG_DEADZONE_PX - 1, 0)).toBe(false);
    expect(isDrag(0, 0, DRAG_DEADZONE_PX, 0)).toBe(true);
  });

  it("measures the straight-line distance, not each axis", () => {
    // 7 px on each axis is under 10 px either way but ~9.9 px across.
    expect(isDrag(0, 0, 7, 7)).toBe(false);
    expect(isDrag(0, 0, 8, 8)).toBe(true);
  });
});

describe("headingDegrees", () => {
  it("reads the map frame: +x is 0°, +y is 90°, counter-clockwise positive", () => {
    expect(headingDegrees(1, 0)).toBe(0);
    expect(headingDegrees(0, 1)).toBe(90);
    expect(headingDegrees(-1, 0)).toBe(180);
    expect(headingDegrees(0, -1)).toBe(-90);
  });

  it("has no answer for no displacement, rather than claiming 0°", () => {
    expect(headingDegrees(0, 0)).toBeNull();
  });
});
