import { describe, expect, it } from "vitest";

import { ESTOP_MOTION, estopEngaged } from "@/lib/robot/estop";

describe("estopEngaged", () => {
  it("is engaged by this tab's latch alone", () => {
    expect(estopEngaged(true, "LOCOMOTION")).toBe(true);
    expect(estopEngaged(true, null)).toBe(true);
  });

  it("is engaged by the robot's reading even without a latch", () => {
    // Another console, or the robot's own remote, stopped it: this tab has
    // nothing latched and must still not show the stop as released.
    expect(estopEngaged(false, ESTOP_MOTION)).toBe(true);
  });

  it("is released only when neither says stop", () => {
    expect(estopEngaged(false, "LOCOMOTION")).toBe(false);
    expect(estopEngaged(false, "DAMPING")).toBe(false);
    expect(estopEngaged(false, null)).toBe(false);
  });
});
