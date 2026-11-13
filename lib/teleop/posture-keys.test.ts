import { describe, expect, it } from "vitest";

import { POSTURE_KEYS, postureForKey } from "@/lib/teleop/posture-keys";
import { isStickKey } from "@/lib/teleop/stick";

describe("the posture keys", () => {
  it("stands on R and lies down on F", () => {
    expect(postureForKey("KeyR")).toBe("STANDUP");
    expect(postureForKey("KeyF")).toBe("LIEDOWN");
  });

  it("never shares a key with a stick, or one press would both drive and change posture", () => {
    for (const { code } of Object.values(POSTURE_KEYS)) {
      expect(isStickKey(code)).toBe(false);
    }
  });

  it("asks for nothing on any other key", () => {
    expect(postureForKey("KeyW")).toBeNull();
    expect(postureForKey("Space")).toBeNull();
  });
});
