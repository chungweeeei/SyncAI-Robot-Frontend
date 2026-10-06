import { describe, expect, it } from "vitest";

import {
  IDLE_MOTION,
  LOCOMOTION_MOTION,
  controllerAfterMotion,
} from "@/lib/robot/controller";

/**
 * The readings that overrule a commanded controller: an arrival at IDLE or at
 * LOCOMOTION ends MPC. Stated as edges, because the level would undo a click
 * the robot has not answered yet.
 */

describe("controllerAfterMotion", () => {
  it("drops a commanded MPC back to RL when the motion returns to IDLE", () => {
    expect(controllerAfterMotion("MPC", "UNKNOWN", IDLE_MOTION)).toBe("RL");
    expect(controllerAfterMotion("MPC", LOCOMOTION_MOTION, IDLE_MOTION)).toBe("RL");
  });

  it("drops a commanded MPC back to RL when the robot starts walking under RL", () => {
    // MPC pressed while lying down, then a stand: the robot comes up under RL.
    expect(controllerAfterMotion("MPC", "LIE_DOWN", LOCOMOTION_MOTION)).toBe("RL");
    expect(controllerAfterMotion("MPC", "STAND", LOCOMOTION_MOTION)).toBe("RL");
    expect(controllerAfterMotion("MPC", "UNKNOWN", LOCOMOTION_MOTION)).toBe("RL");
    expect(controllerAfterMotion("MPC", IDLE_MOTION, LOCOMOTION_MOTION)).toBe("RL");
  });

  it("does not undo an MPC pressed while the robot already read IDLE or LOCOMOTION", () => {
    // The poll that lands between the click and the robot acting on it repeats
    // the reading; resetting here would light RL a second after the operator
    // chose MPC.
    expect(controllerAfterMotion("MPC", IDLE_MOTION, IDLE_MOTION)).toBe("MPC");
    expect(controllerAfterMotion("MPC", LOCOMOTION_MOTION, LOCOMOTION_MOTION)).toBe("MPC");
  });

  it("keeps MPC through every other motion", () => {
    // MPC's own code is out of the backend's table and reads UNKNOWN, which is
    // exactly why IDLE and LOCOMOTION need labels of their own.
    for (const motion of ["UNKNOWN", "STAND", "LIE_DOWN", "DAMPING", "ESTOP"]) {
      expect(controllerAfterMotion("MPC", IDLE_MOTION, motion)).toBe("MPC");
      expect(controllerAfterMotion("MPC", LOCOMOTION_MOTION, motion)).toBe("MPC");
    }
  });

  it("counts the first reading as an arrival", () => {
    expect(controllerAfterMotion("MPC", null, IDLE_MOTION)).toBe("RL");
    expect(controllerAfterMotion("MPC", null, LOCOMOTION_MOTION)).toBe("RL");
    expect(controllerAfterMotion("MPC", null, null)).toBe("MPC");
  });

  it("never touches RL", () => {
    expect(controllerAfterMotion("RL", "UNKNOWN", IDLE_MOTION)).toBe("RL");
    expect(controllerAfterMotion("RL", "UNKNOWN", LOCOMOTION_MOTION)).toBe("RL");
  });
});
