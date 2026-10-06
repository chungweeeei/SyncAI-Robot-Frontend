import { describe, expect, it } from "vitest";

import { IDLE_MOTION, controllerAfterMotion } from "@/lib/robot/controller";

/**
 * The one reading that overrules a commanded controller: a return to IDLE ends
 * MPC. Stated as edges, because the level would undo a click the robot has not
 * answered yet.
 */

describe("controllerAfterMotion", () => {
  it("drops a commanded MPC back to RL when the motion returns to IDLE", () => {
    expect(controllerAfterMotion("MPC", "UNKNOWN", IDLE_MOTION)).toBe("RL");
    expect(controllerAfterMotion("MPC", "LOCOMOTION", IDLE_MOTION)).toBe("RL");
  });

  it("does not undo an MPC pressed while the robot was already idle", () => {
    // IDLE → IDLE is the poll that lands between the click and the robot acting
    // on it; resetting here would light RL a second after the operator chose MPC.
    expect(controllerAfterMotion("MPC", IDLE_MOTION, IDLE_MOTION)).toBe("MPC");
  });

  it("keeps MPC through every motion that is not IDLE", () => {
    // MPC's own code is out of the backend's table and reads UNKNOWN, which is
    // exactly why IDLE needs a label of its own.
    for (const motion of ["UNKNOWN", "LOCOMOTION", "STAND", "DAMPING", "ESTOP"]) {
      expect(controllerAfterMotion("MPC", IDLE_MOTION, motion)).toBe("MPC");
    }
  });

  it("counts the first reading as a return when it is IDLE", () => {
    expect(controllerAfterMotion("MPC", null, IDLE_MOTION)).toBe("RL");
  });

  it("never touches RL", () => {
    expect(controllerAfterMotion("RL", "UNKNOWN", IDLE_MOTION)).toBe("RL");
  });
});
