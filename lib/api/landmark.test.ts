import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ChargerDetectError,
  ChargerDetectNoResponseError,
  detectCharger,
} from "@/lib/api/landmark";

/**
 * The charger sighting's wire. Its pose becomes a waypoint, so a field that
 * went missing has to fail here, and a refusal has to arrive as the backend's
 * own sentence with the reason it named.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const sighting = {
  map: "lab",
  x: 2.4,
  y: -1.1,
  z: 0.03,
  theta: -45,
  marker_z: 0.31,
  consecutive: 5,
  age: 0.1,
  reprojection_error_px: 0.6,
};

describe("detectCharger", () => {
  it("posts an empty body, leaving which charger to the robot", async () => {
    fetchMock.mockResolvedValue(answer(sighting));
    await detectCharger();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/v1/landmarks/detect");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("{}");
  });

  it("reads a sighting, and one with a field this console does not know", async () => {
    fetchMock.mockResolvedValue(answer({ ...sighting, landmark_id: 7 }));
    await expect(detectCharger()).resolves.toEqual(sighting);
  });

  it("refuses an answer without a height rather than storing a waypoint at none", async () => {
    fetchMock.mockResolvedValue(answer({ ...sighting, z: undefined }));
    await expect(detectCharger()).rejects.toThrow(/\/api\/v1\/landmarks\/detect.*z/);
  });

  it("carries a refusal's sentence and its code", async () => {
    const detail = "The charger was not seen steadily. Point the robot at it and try again.";
    fetchMock.mockResolvedValue(answer({ detail, code: "landmark_not_detected" }, 409));

    const error = await detectCharger().catch((thrown: unknown) => thrown);
    expect(error).toBeInstanceOf(ChargerDetectError);
    expect((error as ChargerDetectError).message).toBe(detail);
    expect((error as ChargerDetectError).code).toBe("landmark_not_detected");
  });

  it("leaves a refusal with no code as the plain sentence", async () => {
    fetchMock.mockResolvedValue(answer({ detail: "The robot cannot look right now." }, 502));

    const error = await detectCharger().catch((thrown: unknown) => thrown);
    expect(error).not.toBeInstanceOf(ChargerDetectError);
    expect((error as Error).message).toBe("The robot cannot look right now.");
  });

  it("gives the wait a deadline of its own", async () => {
    fetchMock.mockResolvedValue(answer(sighting));
    await detectCharger();

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["a request that never reached the robot", new TypeError("Failed to fetch")],
    ["a wait that ran out", new DOMException("timed out", "TimeoutError")],
  ])("reports %s as no answer", async (_what, thrown) => {
    fetchMock.mockRejectedValue(thrown);
    await expect(detectCharger()).rejects.toBeInstanceOf(ChargerDetectNoResponseError);
  });
});
