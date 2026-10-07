import { describe, expect, it } from "vitest";

import { estopEngaged, requestAfterReading } from "@/lib/robot/estop";

describe("estopEngaged", () => {
  it("is engaged by this tab's press before the robot has answered", () => {
    expect(estopEngaged(true, false)).toBe(true);
    expect(estopEngaged(true, null)).toBe(true);
  });

  it("is engaged by the robot's reading without a press here", () => {
    // Another console, or the driver itself, engaged the lock: this tab
    // pressed nothing and must still not show the stop as released.
    expect(estopEngaged(false, true)).toBe(true);
  });

  it("is released only when neither says stop, and no frame is not a release signal", () => {
    expect(estopEngaged(false, false)).toBe(false);
    expect(estopEngaged(false, null)).toBe(false);
  });
});

describe("requestAfterReading", () => {
  it("hands over to the reading once the robot reports the lock on", () => {
    expect(requestAfterReading(true, true)).toBe(false);
  });

  it("holds the press across the poll gap until then", () => {
    expect(requestAfterReading(true, false)).toBe(true);
    expect(requestAfterReading(true, null)).toBe(true);
  });

  it("never invents a request", () => {
    expect(requestAfterReading(false, true)).toBe(false);
    expect(requestAfterReading(false, false)).toBe(false);
  });
});
