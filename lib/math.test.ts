import { describe, expect, it } from "vitest";

import { clamp } from "@/lib/math";

describe("clamp", () => {
  it("holds a value inside its range and leaves one already there alone", () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it("answers the upper bound when the range is empty, so a panel wider than its room pins left", () => {
    // min > max is what a drag clamp gets on a screen narrower than the panel.
    expect(clamp(5, 10, 0)).toBe(0);
  });
});
