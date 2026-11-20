import { describe, expect, it } from "vitest";

import { DEMO_PROPS } from "@/lib/scene/demo-site";
import { LOOP_PERIOD_S, chaseCamera, loopPose } from "@/lib/scene/walk-loop";

/** The G23's half-width plus a margin, metres. */
const CLEARANCE_M = 0.35;
const LAP = Array.from({ length: 400 }, (_, i) => (i / 400) * LOOP_PERIOD_S);

describe("DEMO_PROPS", () => {
  it("leaves the robot's oval clear, so it never walks through a shelf or a crate", () => {
    for (const t of LAP) {
      const { x, y } = loopPose(t);
      for (const prop of DEMO_PROPS) {
        const dx = Math.max(0, Math.abs(x - prop.x) - prop.w / 2);
        const dy = Math.max(0, Math.abs(y - prop.y) - prop.d / 2);
        expect(Math.hypot(dx, dy)).toBeGreaterThan(CLEARANCE_M);
      }
    }
  });

  it("never stands between the camera and the robot, all the way round", () => {
    for (const t of LAP) {
      const { position, target } = chaseCamera(t);
      // Along the sight line, short of the robot's own body.
      for (let k = 0; k <= 60; k += 1) {
        const f = (k / 60) * 0.85;
        const px = position[0] + (target[0] - position[0]) * f;
        const py = position[1] + (target[1] - position[1]) * f;
        const pz = position[2] + (target[2] - position[2]) * f;
        for (const prop of DEMO_PROPS) {
          const inside =
            Math.abs(px - prop.x) <= prop.w / 2 &&
            Math.abs(py - prop.y) <= prop.d / 2 &&
            pz <= prop.h;
          expect(inside, `t=${t.toFixed(1)} blocked by the prop at ${prop.x}, ${prop.y}`).toBe(false);
        }
      }
    }
  });
});
