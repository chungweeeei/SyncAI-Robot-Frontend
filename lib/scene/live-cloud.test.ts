import * as THREE from "three";
import { describe, expect, it } from "vitest";

import { heightColor, writeHeightColor } from "@/lib/scene/live-cloud";

/**
 * The scan's colours come from a table rather than a conversion per point.
 * The table must not be a different ramp: the same height reads as the same
 * colour to within what a screen can show.
 */
describe("writeHeightColor", () => {
  it("matches the HSL sweep to under one 8-bit step, across and past the band", () => {
    const exact = new THREE.Color();
    const out = new Float32Array(3);
    for (let z = -2; z <= 5; z += 0.0137) {
      heightColor(z, exact);
      writeHeightColor(z, out, 0);
      expect(Math.abs(out[0] - exact.r)).toBeLessThan(1 / 255);
      expect(Math.abs(out[1] - exact.g)).toBeLessThan(1 / 255);
      expect(Math.abs(out[2] - exact.b)).toBeLessThan(1 / 255);
    }
  });

  it("writes at the offset it is given and nowhere else", () => {
    const out = new Float32Array(9).fill(-1);
    writeHeightColor(1, out, 3);
    expect([...out.slice(0, 3), ...out.slice(6)]).toEqual([-1, -1, -1, -1, -1, -1]);
    expect(out[3]).toBeGreaterThanOrEqual(0);
  });
});
