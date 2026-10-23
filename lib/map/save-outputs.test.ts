import { describe, expect, it } from "vitest";

import { DEFAULT_SAVE_OUTPUTS, saveOutputsValid } from "@/lib/map/save-outputs";

describe("saveOutputsValid", () => {
  it.each([
    [{ grid: true, octomap: false }, true],
    [{ grid: false, octomap: true }, true],
    [{ grid: true, octomap: true }, true],
    // The backend refuses this one; the dialog must never send it.
    [{ grid: false, octomap: false }, false],
  ])("%o → %s", (outputs, valid) => {
    expect(saveOutputsValid(outputs)).toBe(valid);
  });

  it("starts from a choice it would accept", () => {
    expect(saveOutputsValid(DEFAULT_SAVE_OUTPUTS)).toBe(true);
  });
});
