import { describe, expect, it } from "vitest";

import { RobotStateSchema } from "@/lib/types/robot";

/**
 * The console's single most-read boundary: every screen hangs off this frame at
 * 1 Hz. The schema exists for one failure in particular — a field the backend
 * renamed used to arrive as `undefined`, cast to a RobotState, and surface
 * pages later as a blank readout or a crash inside a render.
 *
 * Three properties are the contract, and all three are policy rather than
 * shape, so only a test says them: an added field must not break the console,
 * a removed or retyped one must, and the two fields the backend keeps open
 * must stay open.
 */
const frame = {
  timestamp: 1_758_000_000,
  robot_id: "robot01",
  map: "map/dp2f/gridmap.yaml",
  mode: "AUTO",
  low_level_mode: { policy: "PPO", motion: "LOCOMOTION" },
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

  it("ignores a field the backend added", () => {
    // Adding to the response must never be a breaking change for the console,
    // or the two repos cannot be deployed independently.
    const parsed = RobotStateSchema.parse({ ...frame, gait_phase: 0.25 });
    expect(parsed).toEqual(frame);
    expect("gait_phase" in parsed).toBe(false);
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
    // CHAMP and ISSAC are real policies the REST command surface does not
    // expose, and MPC's motion code is genuinely unknown — an enum here would
    // reject a frame that is perfectly valid.
    for (const policy of ["PPO", "HIMLOCO", "CHAMP", "ISSAC", "UNKNOWN"]) {
      const result = RobotStateSchema.safeParse({
        ...frame,
        low_level_mode: { policy, motion: "WHATEVER" },
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
