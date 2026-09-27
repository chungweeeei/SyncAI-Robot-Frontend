import { describe, expect, it } from "vitest";

import {
  DEADZONE,
  applyDeadzone,
  clampStick,
  commandFrom,
  isStickKey,
  resolveStick,
  type StickValue,
} from "@/lib/teleop/stick";
import type { TeleopVector } from "@/lib/types/robot";

/**
 * The rules a sign error or a lost clamp would break. Each one is something an
 * operator would feel through the robot rather than see on a screen: a
 * diagonal that runs faster than straight ahead, a lurch off the deadzone
 * ring, a turn key that strafes.
 */

const NONE = new Set<string>();
const keys = (...codes: string[]) => new Set(codes);

/** The command for a set of held keys, as the hook computes it. */
function fromKeys(...codes: string[]): TeleopVector {
  const held = keys(...codes);
  const left = resolveStick("left", null, held).value;
  const right = resolveStick("right", null, held).value;
  // `+ 0` folds -0 into 0: a negated zero is still no command.
  const v = commandFrom(left, right);
  return { vx: v.vx + 0, vy: v.vy + 0, wz: v.wz + 0 };
}

const magnitude = (v: StickValue) => Math.hypot(v.x, v.y);

describe("the body-frame signs (REP-103)", () => {
  it("drives forward on W and backward on S", () => {
    expect(fromKeys("KeyW")).toEqual({ vx: 1, vy: 0, wz: 0 });
    expect(fromKeys("KeyS")).toEqual({ vx: -1, vy: 0, wz: 0 });
  });

  it("strafes left on Q as +vy, because body-frame y points left", () => {
    expect(fromKeys("KeyQ")).toEqual({ vx: 0, vy: 1, wz: 0 });
    expect(fromKeys("KeyE")).toEqual({ vx: 0, vy: -1, wz: 0 });
  });

  it("turns left on A as +wz, counter-clockwise", () => {
    expect(fromKeys("KeyA")).toEqual({ vx: 0, vy: 0, wz: 1 });
    expect(fromKeys("KeyD")).toEqual({ vx: 0, vy: 0, wz: -1 });
  });

  it("maps a stick pushed up and left to forward and leftward", () => {
    const v = commandFrom({ x: -0.5, y: -0.5 }, { x: 0, y: 0 });
    expect(v.vx).toBeGreaterThan(0);
    expect(v.vy).toBeGreaterThan(0);
  });

  it("turns left when the right stick is pushed left", () => {
    expect(commandFrom({ x: 0, y: 0 }, { x: -1, y: 0 }).wz).toBe(1);
  });
});

describe("the key bindings", () => {
  it("rotates on A/D and strafes on Q/E, never the other way round", () => {
    // Swapped once, and it read as sideways drift on every attempted turn.
    expect(fromKeys("KeyA").vy).toBe(0);
    expect(fromKeys("KeyQ").wz).toBe(0);
  });

  it("cancels opposing keys to no command", () => {
    expect(fromKeys("KeyW", "KeyS")).toEqual({ vx: 0, vy: 0, wz: 0 });
    expect(fromKeys("KeyA", "KeyD")).toEqual({ vx: 0, vy: 0, wz: 0 });
  });

  it("reports a stick idle when its keys cancel", () => {
    expect(resolveStick("left", null, keys("KeyQ", "KeyE")).active).toBe(false);
  });

  it("drives only on the six stick keys", () => {
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "KeyQ", "KeyE"]) {
      expect(isStickKey(code)).toBe(true);
    }
    expect(isStickKey("KeyR")).toBe(false);
    expect(isStickKey("Space")).toBe(false);
    // Inherited keys are not bindings.
    expect(isStickKey("toString")).toBe(false);
  });
});

describe("the reachable set", () => {
  it("never commands a diagonal faster than straight ahead", () => {
    const diagonal = fromKeys("KeyW", "KeyQ");
    expect(Math.hypot(diagonal.vx, diagonal.vy)).toBeCloseTo(1, 10);
    expect(magnitude(clampStick("left", { x: 3, y: -4 }))).toBeCloseTo(1, 10);
  });

  it("keeps a clamped deflection pointing the way the finger went", () => {
    const c = clampStick("left", { x: 3, y: -4 });
    expect(c.x).toBeCloseTo(0.6, 10);
    expect(c.y).toBeCloseTo(-0.8, 10);
  });

  it("leaves a deflection inside the disc alone", () => {
    expect(clampStick("left", { x: 0.3, y: 0.4 })).toEqual({ x: 0.3, y: 0.4 });
  });

  it("keeps the right stick on one axis: rotation only", () => {
    expect(clampStick("right", { x: 2, y: 0.9 })).toEqual({ x: 1, y: 0 });
    expect(clampStick("right", { x: -2, y: -0.9 })).toEqual({ x: -1, y: 0 });
    expect(commandFrom({ x: 0, y: 0 }, { x: 0, y: -1 }).wz + 0).toBe(0);
  });
});

describe("the deadzone", () => {
  it("commands nothing inside the ring", () => {
    expect(applyDeadzone({ x: DEADZONE * 0.99, y: 0 })).toEqual({ x: 0, y: 0 });
  });

  it("starts from zero at the ring rather than jumping", () => {
    // A plain cutoff would make the smallest command DEADZONE-sized: a lurch.
    const justOut = applyDeadzone({ x: DEADZONE + 1e-6, y: 0 });
    expect(justOut.x).toBeGreaterThan(0);
    expect(justOut.x).toBeLessThan(1e-5);
  });

  it("still reaches full scale at full travel", () => {
    expect(magnitude(applyDeadzone({ x: 0, y: -1 }))).toBeCloseTo(1, 10);
    expect(magnitude(applyDeadzone({ x: 0.6, y: 0.8 }))).toBeCloseTo(1, 10);
  });

  it("grows with the deflection and keeps its direction", () => {
    let last = 0;
    for (let m = DEADZONE; m <= 1; m += 0.05) {
      const out = applyDeadzone({ x: m * 0.6, y: m * -0.8 });
      const size = magnitude(out);
      expect(size).toBeGreaterThanOrEqual(last);
      last = size;
      if (size > 0) {
        expect(out.x / size).toBeCloseTo(0.6, 10);
        expect(out.y / size).toBeCloseTo(-0.8, 10);
      }
    }
  });
});

describe("pointer and keyboard on one stick", () => {
  it("lets a captured pointer own the whole stick", () => {
    const held = keys("KeyW");
    const pointer = { x: 0.5, y: 0 };
    expect(resolveStick("left", pointer, held)).toEqual({
      value: pointer,
      active: true,
    });
  });

  it("keeps each stick's input separate", () => {
    // A pointer on the left stick does not silence A/D on the right one.
    const right = resolveStick("right", null, keys("KeyA"));
    expect(right).toEqual({ value: { x: -1, y: 0 }, active: true });
  });

  it("is idle with nothing held", () => {
    expect(resolveStick("left", null, NONE)).toEqual({
      value: { x: 0, y: 0 },
      active: false,
    });
  });
});
