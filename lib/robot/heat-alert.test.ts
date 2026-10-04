import { describe, expect, it } from "vitest";

import {
  type HeatAlertPhase,
  hottestMotor,
  nextHeatAlertPhase,
} from "@/lib/robot/heat-alert";
import { TEMP_ALERT_C, TEMP_WARN_C } from "@/lib/robot/levels";

/**
 * The notice's edges: when it is raised, what keeps it up, and what has to
 * happen before it may be raised a second time. Stated against the named
 * thresholds so a moved number moves the test with it.
 */

describe("nextHeatAlertPhase", () => {
  it("raises strictly above the alert limit, not on it", () => {
    expect(nextHeatAlertPhase("clear", TEMP_ALERT_C)).toBe("clear");
    expect(nextHeatAlertPhase("clear", TEMP_ALERT_C + 1)).toBe("raised");
  });

  it("stays armed between the red readout and the alert limit", () => {
    expect(nextHeatAlertPhase("clear", TEMP_WARN_C)).toBe("clear");
    expect(nextHeatAlertPhase("clear", TEMP_ALERT_C - 1)).toBe("clear");
  });

  it("keeps a raised notice up while the motor is still hot", () => {
    // Back under the alert limit but not yet under the red readout: the
    // operator has not been told anything that stopped being true.
    expect(nextHeatAlertPhase("raised", TEMP_ALERT_C + 5)).toBe("raised");
    expect(nextHeatAlertPhase("raised", TEMP_ALERT_C - 1)).toBe("raised");
    expect(nextHeatAlertPhase("raised", TEMP_WARN_C)).toBe("raised");
  });

  it("does not raise a dismissed notice again until the motor has cooled", () => {
    expect(nextHeatAlertPhase("dismissed", TEMP_ALERT_C + 10)).toBe("dismissed");
    expect(nextHeatAlertPhase("dismissed", TEMP_WARN_C)).toBe("dismissed");
    expect(nextHeatAlertPhase("dismissed", TEMP_WARN_C - 1)).toBe("clear");
    expect(nextHeatAlertPhase("clear", TEMP_ALERT_C + 1)).toBe("raised");
  });

  it("clears under the red readout, and when there is no reading", () => {
    expect(nextHeatAlertPhase("raised", TEMP_WARN_C - 1)).toBe("clear");
    expect(nextHeatAlertPhase("raised", undefined)).toBe("clear");
    expect(nextHeatAlertPhase("dismissed", undefined)).toBe("clear");
  });

  it("returns the same phase for a reading that changes nothing", () => {
    // Identity, not equality: the dashboard adjusts state during render and
    // relies on an unchanged answer to stop re-rendering.
    const prev: HeatAlertPhase = "raised";
    expect(nextHeatAlertPhase(prev, TEMP_ALERT_C + 2)).toBe(prev);
  });
});

describe("hottestMotor", () => {
  it("names the hottest motor, the first listed on a tie", () => {
    const motors = [
      { name: "FL_Knee_joint", temperature: 60, error: 0 },
      { name: "HL_Knee_joint", temperature: 87, error: 0 },
      { name: "HR_Knee_joint", temperature: 87, error: 0 },
    ];
    expect(hottestMotor(motors)?.name).toBe("HL_Knee_joint");
  });

  it("has nothing to name when the robot reports no motors", () => {
    expect(hottestMotor([])).toBeUndefined();
  });
});
