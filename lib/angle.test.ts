import { describe, expect, it } from "vitest";

import { normalizeTheta } from "@/lib/angle";

/**
 * The fold is (-180, 180], not [-180, 180), and that asymmetry is the whole
 * reason this function exists: the backend's MoveParams validates
 * `gt=-180, le=180`, so the one value the usual fold produces is the one value
 * the endpoint rejects. Everything that reaches the wire goes through here, so
 * a regression is a 422 on a real robot command.
 */
describe("normalizeTheta", () => {
  it("leaves an in-range heading alone", () => {
    for (const deg of [0, 1, 90, 179.9, -90, -179.9]) {
      expect(normalizeTheta(deg)).toBeCloseTo(deg, 10);
    }
  });

  it("keeps +180 and never produces -180", () => {
    expect(normalizeTheta(180)).toBe(180);
    expect(normalizeTheta(-180)).toBe(180);
    expect(normalizeTheta(540)).toBe(180);
    expect(normalizeTheta(-540)).toBe(180);
  });

  it("folds a heading that has gone round", () => {
    expect(normalizeTheta(370)).toBeCloseTo(10, 10);
    expect(normalizeTheta(-370)).toBeCloseTo(-10, 10);
    expect(normalizeTheta(721)).toBeCloseTo(1, 10);
  });

  it("crosses the seam the short way", () => {
    expect(normalizeTheta(181)).toBeCloseTo(-179, 10);
    expect(normalizeTheta(-181)).toBeCloseTo(179, 10);
  });

  it("is idempotent", () => {
    for (const deg of [-720, -181, -180, 0, 180, 181, 359, 1000]) {
      const once = normalizeTheta(deg);
      expect(normalizeTheta(once)).toBeCloseTo(once, 10);
    }
  });

  it("stays inside the range the backend accepts", () => {
    for (let deg = -1000; deg <= 1000; deg += 0.5) {
      const folded = normalizeTheta(deg);
      expect(folded).toBeGreaterThan(-180);
      expect(folded).toBeLessThanOrEqual(180);
    }
  });
});
