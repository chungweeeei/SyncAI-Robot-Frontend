import { describe, expect, it } from "vitest";

import { readState, readStatus } from "@/lib/api/read-state";

describe("readStatus", () => {
  it("is loading for a read that has never answered, even while its retry fails", () => {
    expect(readStatus({ isPending: true, isError: false })).toBe("loading");
    expect(readStatus({ isPending: true, isError: true })).toBe("loading");
  });

  it("is an error, not an empty answer, once a read has failed", () => {
    expect(readStatus({ isPending: false, isError: true })).toBe("error");
    expect(readStatus({ isPending: false, isError: false })).toBe("ok");
  });
});

describe("readState", () => {
  it("hands the backend's sentence through verbatim", () => {
    const error = new Error("The robot has no map loaded.");
    expect(readState({ isPending: false, isError: true, error })).toEqual({
      status: "error",
      error: "The robot has no map loaded.",
    });
    expect(readState({ isPending: false, isError: false, error: null }).error).toBeNull();
  });
});
