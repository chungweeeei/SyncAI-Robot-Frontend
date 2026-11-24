import { describe, expect, it } from "vitest";

import { RobotStateSchema } from "@/lib/types/robot";

/**
 * The 1 Hz frame every screen hangs off. The contract is policy, so only a
 * test states it: an added field must not break the console, a removed or
 * retyped one must, and the two open fields stay open.
 */
const frame = {
  timestamp: 1_758_000_000,
  robot_id: "robot01",
  map: "map/dp2f/gridmap.yaml",
  mode: "AUTO",
  low_level_mode: { policy: "PPO", motion: "LOCOMOTION", safety_locked: false },
  localization_valid: true,
  localization_status: {
    position: { x: 1.2, y: -3.4, z: 0, theta: 90 },
    velocity: 0.31,
  },
  network_status: {
    ssid: "site-wifi",
    bssid: "aa:bb:cc:dd:ee:ff",
    rssi: -52,
    ip_address: "10.8.140.138",
    mac_address: "11:22:33:44:55:66",
  },
  battery_status: { battery_percentage: 88 },
  motor_status: [{ name: "FL_Knee_joint", temperature: 41, error: 0 }],
};

describe("RobotStateSchema", () => {
  it("accepts a real frame", () => {
    expect(RobotStateSchema.parse(frame)).toEqual(frame);
  });

  it("carries the robot's model, and reads a backend from before it without one", () => {
    // The two repos are deployed independently: a frame with no model is an
    // older backend's, not a broken one.
    expect(RobotStateSchema.parse({ ...frame, robot_model: "m20" }).robot_model).toBe("m20");
    expect(RobotStateSchema.parse(frame).robot_model).toBeUndefined();
  });

  it("ignores a field the backend added", () => {
    // Or the two repos cannot be deployed independently.
    const parsed = RobotStateSchema.parse({ ...frame, gait_phase: 0.25 });
    expect(parsed).toEqual(frame);
    expect("gait_phase" in parsed).toBe(false);
  });

  it("accepts a frame from a backend without the state rollup", () => {
    // `frame` carries none; the newer backend's field parses too.
    expect(RobotStateSchema.parse(frame).state).toBeUndefined();
    expect(RobotStateSchema.parse({ ...frame, state: "CHARGING" }).state).toBe(
      "CHARGING",
    );
  });

  it("accepts a frame from a backend without the state machine's fields", () => {
    // Their absence is itself the reading (`gateSupported`), so they must
    // come through absent and never defaulted to a value.
    const parsed = RobotStateSchema.parse({ ...frame, state: "UNINITIALIZED" });
    expect("localization_converged" in parsed).toBe(false);
    expect("state_message" in parsed).toBe(false);
  });

  it("carries the state machine's fields when the backend sends them", () => {
    const parsed = RobotStateSchema.parse({
      ...frame,
      state: "ERROR",
      localization_converged: false,
      state_message: "Task robot01-task-1-1 failed: the way to the goal is closed.",
    });
    expect(parsed.localization_converged).toBe(false);
    expect(parsed.state_message).toBe(
      "Task robot01-task-1-1 failed: the way to the goal is closed.",
    );
    // An empty sentence is an answer too: nothing to add to the state's name.
    expect(RobotStateSchema.parse({ ...frame, state_message: "" }).state_message).toBe("");
  });

  it("rejects a retyped state machine field rather than reading it as absent", () => {
    expect(
      RobotStateSchema.safeParse({ ...frame, localization_converged: "yes" }).success,
    ).toBe(false);
    expect(RobotStateSchema.safeParse({ ...frame, state_message: null }).success).toBe(false);
  });

  it("rejects a renamed field and names it", () => {
    const result = RobotStateSchema.safeParse({
      ...frame,
      battery_status: { percentage: 88 },
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path.join(".")).toBe(
      "battery_status.battery_percentage",
    );
  });

  it("rejects a retyped field", () => {
    expect(
      RobotStateSchema.safeParse({ ...frame, timestamp: "1758000000" }).success,
    ).toBe(false);
    expect(
      RobotStateSchema.safeParse({ ...frame, localization_valid: 1 }).success,
    ).toBe(false);
  });

  it("closes the mode union", () => {
    for (const mode of ["MAINTENANCE", "MANUAL", "AUTO"]) {
      expect(RobotStateSchema.safeParse({ ...frame, mode }).success).toBe(true);
    }
    expect(RobotStateSchema.safeParse({ ...frame, mode: "DOCKED" }).success).toBe(
      false,
    );
  });

  it("leaves low_level_mode open, because the backend legitimately says UNKNOWN", () => {
    // Unexposed policies and MPC's motion code are legitimately UNKNOWN.
    for (const policy of ["PPO", "HIMLOCO", "CHAMP", "ISSAC", "UNKNOWN"]) {
      const result = RobotStateSchema.safeParse({
        ...frame,
        low_level_mode: { policy, motion: "WHATEVER", safety_locked: false },
      });
      expect(result.success).toBe(true);
    }
  });

  it("accepts the empty motor list the driver reports before bringup", () => {
    expect(
      RobotStateSchema.safeParse({ ...frame, motor_status: [] }).success,
    ).toBe(true);
  });

  it("rejects a malformed entry inside the motor list", () => {
    const result = RobotStateSchema.safeParse({
      ...frame,
      motor_status: [{ name: "FL_Knee_joint", temperature: "hot", error: 0 }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].path.join(".")).toBe(
      "motor_status.0.temperature",
    );
  });
});
