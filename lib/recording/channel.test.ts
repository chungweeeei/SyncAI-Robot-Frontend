import { describe, expect, it } from "vitest";

import { isUsableChannel } from "@/lib/recording/channel";

/**
 * The recorder's channel field refuses only what is certainly wasted, and
 * accepts a channel that does not exist yet, because arming a recorder before
 * its source comes up is a real use.
 */
describe("isUsableChannel", () => {
  it("accepts a channel name, with or without a leading slash", () => {
    expect(isUsableChannel("livox/lidar")).toBe(true);
    expect(isUsableChannel("/tf")).toBe(true);
  });

  it("refuses an empty name", () => {
    expect(isUsableChannel("")).toBe(false);
  });

  it("refuses a name with whitespace anywhere in it", () => {
    expect(isUsableChannel("livox lidar")).toBe(false);
    expect(isUsableChannel(" /tf")).toBe(false);
    expect(isUsableChannel("/tf\t")).toBe(false);
  });
});
