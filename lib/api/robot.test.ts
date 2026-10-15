import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setInitialPose } from "@/lib/api/robot";

/**
 * The initial pose's height is the one field whose absence means something:
 * the localizer keeps the storey it is on. So a pose with no floor must send
 * no `z`, and one on the ground floor must send its 0.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ message: "ok" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function sentBody(): Record<string, unknown> {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("setInitialPose", () => {
  it("leaves z out when no floor was picked, so the localizer keeps its storey", async () => {
    await setInitialPose({ x: 1, y: 2, theta: 90 });
    expect(sentBody()).toEqual({ x: 1, y: 2, theta: 90 });
  });

  it("sends the ground floor's 0, which overrules a robot believed upstairs", async () => {
    await setInitialPose({ x: 1, y: 2, theta: 90, z: 0 });
    expect(sentBody()).toEqual({ x: 1, y: 2, theta: 90, z: 0 });
  });

  it("sends an upper floor's ground height", async () => {
    await setInitialPose({ x: 1, y: 2, theta: 90, z: 3.2 });
    expect(sentBody()).toMatchObject({ z: 3.2 });
  });
});
