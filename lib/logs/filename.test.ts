import { describe, expect, it } from "vitest";

import { logBundleFilename } from "@/lib/logs/filename";

describe("logBundleFilename", () => {
  it("names the file as the robot does: id, -logs-, a compact UTC stamp, .tar", () => {
    // The backend's _stamp is strftime("%Y%m%dT%H%M%SZ") in UTC.
    expect(logBundleFilename("robot01", Date.UTC(2026, 10, 20, 3, 4, 5))).toBe(
      "robot01-logs-20261120T030405Z.tar",
    );
  });

  it("stamps in UTC, never the browser's zone, so it matches the robot's name", () => {
    // 23:59:59 UTC on the 20th is already the 21st in Taipei.
    expect(logBundleFilename("r", Date.UTC(2026, 10, 20, 23, 59, 59))).toBe(
      "r-logs-20261120T235959Z.tar",
    );
  });

  it("falls back to 'robot' before the robot has said its id, never '-logs-…'", () => {
    const at = Date.UTC(2026, 0, 2, 3, 4, 5);
    expect(logBundleFilename(null, at)).toBe("robot-logs-20260102T030405Z.tar");
    expect(logBundleFilename("", at)).toBe("robot-logs-20260102T030405Z.tar");
  });
});
