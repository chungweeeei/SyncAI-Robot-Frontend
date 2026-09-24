import { describe, expect, it } from "vitest";

import { runSeconds } from "@/lib/task/history";

describe("runSeconds", () => {
  it("is null, not zero, when the run has no close time", () => {
    expect(runSeconds("2026-09-18T09:40:00Z", null)).toBeNull();
  });

  it("measures between the two server timestamps", () => {
    expect(runSeconds("2026-09-18T09:40:00Z", "2026-09-18T09:44:12Z")).toBe(252);
  });

  it("never reports a negative duration", () => {
    expect(runSeconds("2026-09-18T09:40:05Z", "2026-09-18T09:40:00Z")).toBe(0);
  });
});
