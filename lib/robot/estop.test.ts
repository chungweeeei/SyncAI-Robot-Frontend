import { describe, expect, it } from "vitest";

import { estopEngaged, estopLine, requestAfterReading } from "@/lib/robot/estop";

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

describe("estopLine", () => {
  const base = { engaged: false, confirmed: false, releasing: false, refusedRequest: null };

  it("says a refused stop out loud, since silence reads as stopped", () => {
    expect(estopLine({ ...base, refusedRequest: true })).toBe("refused");
  });

  it("drops a refused stop once the robot is locked anyway", () => {
    // Another console's lock holds: the robot is stopped, which is the news.
    expect(estopLine({ ...base, engaged: true, confirmed: true, refusedRequest: true })).toBe(
      "stopped",
    );
  });

  it("calls a press stopped only once the robot reports the lock", () => {
    expect(estopLine({ ...base, engaged: true })).toBe("stopping");
    expect(estopLine({ ...base, engaged: true, confirmed: true })).toBe("stopped");
  });

  it("keeps a refused release on screen while the robot stays stopped", () => {
    expect(
      estopLine({ ...base, engaged: true, confirmed: true, refusedRequest: false }),
    ).toBe("release-refused");
  });

  it("says a release is on its way, never released, until the reading clears", () => {
    expect(estopLine({ ...base, engaged: true, confirmed: true, releasing: true })).toBe(
      "releasing",
    );
  });

  it("says nothing while the robot is free to move", () => {
    expect(estopLine(base)).toBeNull();
  });
});
