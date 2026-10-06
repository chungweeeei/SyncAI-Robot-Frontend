import { describe, expect, it } from "vitest";

import { START_NEEDS_MAPPING_MODE, mappingRunFace } from "@/lib/map/run-face";

/**
 * The rule that decides what the run strip offers. Each case is a press the
 * robot would refuse, or a state the console cannot vouch for, that the strip
 * must not offer a button for.
 */

const status = (state: "idle" | "mapping" | "resetting" | "unknown", key_poses = 0) => ({
  state,
  key_poses,
  loop_closures: 0,
});

describe("mappingRunFace", () => {
  it("holds Start with the reason outside mapping mode", () => {
    expect(
      mappingRunFace({ inMapping: false, run: status("idle"), status: "ok" }),
    ).toEqual({ kind: "start", enabled: false, reason: START_NEEDS_MAPPING_MODE });
  });

  it("offers nothing while the first poll is still loading", () => {
    expect(mappingRunFace({ inMapping: true, run: null, status: "loading" })).toEqual({
      kind: "held",
      readout: "Checking…",
    });
  });

  it("fails closed when the poll cannot be read", () => {
    expect(mappingRunFace({ inMapping: true, run: null, status: "error" })).toEqual({
      kind: "held",
      readout: "Unknown",
    });
  });

  it("fails closed when the robot itself says unknown", () => {
    expect(
      mappingRunFace({ inMapping: true, run: status("unknown"), status: "ok" }),
    ).toEqual({ kind: "held", readout: "Unknown" });
  });

  it("offers Start while idle", () => {
    expect(mappingRunFace({ inMapping: true, run: status("idle"), status: "ok" })).toEqual({
      kind: "start",
      enabled: true,
      reason: null,
    });
  });

  it("holds every button while the robot resets", () => {
    expect(
      mappingRunFace({ inMapping: true, run: status("resetting"), status: "ok" }),
    ).toEqual({ kind: "held", readout: "Resetting…" });
  });

  it("shows the run while mapping", () => {
    expect(
      mappingRunFace({ inMapping: true, run: status("mapping", 12), status: "ok" }),
    ).toEqual({ kind: "run" });
  });
});
