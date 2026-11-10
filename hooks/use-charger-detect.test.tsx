import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChargerDetectResult } from "@/lib/api/landmark";

/**
 * What a charger sighting may become. The pose goes into a waypoint, so the
 * rules are about when there is none: a refusal, and an answer for a map
 * other than the one being edited.
 */

const detectCharger = vi.fn<() => Promise<ChargerDetectResult>>();

vi.mock("@/lib/api/landmark", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/landmark")>()),
  detectCharger,
}));

const { ChargerDetectError, ChargerDetectNoResponseError } = await import(
  "@/lib/api/landmark"
);
const { useChargerDetect } = await import("@/hooks/use-charger-detect");

function sighting(over: Partial<ChargerDetectResult> = {}): ChargerDetectResult {
  return {
    map: "lab",
    x: 2.4,
    y: -1.1,
    z: 0.03,
    theta: -45,
    marker_z: 0.31,
    consecutive: 5,
    age: 0.1,
    reprojection_error_px: 0.6,
    ...over,
  };
}

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { wrapper, invalidate };
}

beforeEach(() => {
  detectCharger.mockReset();
});

describe("useChargerDetect", () => {
  it("hands back the measured pose, its z untouched, and invalidates nothing", async () => {
    detectCharger.mockResolvedValue(sighting());
    const { wrapper, invalidate } = setup();
    const { result } = renderHook(() => useChargerDetect("lab"), { wrapper });

    let pose: unknown;
    await act(async () => {
      ({ pose } = await result.current.run());
    });

    expect(pose).toEqual({ x: 2.4, y: -1.1, z: 0.03, theta: -45 });
    expect(result.current.error).toBeNull();
    expect(result.current.busy).toBe(false);
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("is busy while the robot looks", async () => {
    let answer: (found: ChargerDetectResult) => void = () => {};
    detectCharger.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { wrapper } = setup();
    const { result } = renderHook(() => useChargerDetect("lab"), { wrapper });

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.run();
    });
    await waitFor(() => expect(result.current.busy).toBe(true));

    await act(async () => {
      answer(sighting());
      await pending;
    });
    await waitFor(() => expect(result.current.busy).toBe(false));
  });

  it("refuses a sighting on another map, and gives no pose", async () => {
    detectCharger.mockResolvedValue(sighting({ map: "warehouse" }));
    const { wrapper } = setup();
    const { result } = renderHook(() => useChargerDetect("lab"), { wrapper });

    let pose: unknown = "unset";
    await act(async () => {
      ({ pose } = await result.current.run());
    });

    expect(pose).toBeNull();
    await waitFor(() => expect(result.current.error).toContain(`"warehouse"`));
    expect(result.current.code).toBeNull();
  });

  it("keeps the backend's sentence and its code, then drops both on the next success", async () => {
    const sentence = "The charger was not seen. Point the robot at it and try again.";
    detectCharger.mockRejectedValueOnce(
      new ChargerDetectError(sentence, "landmark_not_detected"),
    );
    detectCharger.mockResolvedValueOnce(sighting());
    const { wrapper } = setup();
    const { result } = renderHook(() => useChargerDetect("lab"), { wrapper });

    let pose: unknown = "unset";
    await act(async () => {
      ({ pose } = await result.current.run());
    });
    expect(pose).toBeNull();
    await waitFor(() => expect(result.current.error).toBe(sentence));
    expect(result.current.code).toBe("landmark_not_detected");

    await act(async () => {
      ({ pose } = await result.current.run());
    });
    expect(pose).toMatchObject({ x: 2.4, y: -1.1 });
    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.code).toBeNull();
  });

  it("tells a robot that never answered from one that refused", async () => {
    detectCharger.mockRejectedValueOnce(new ChargerDetectNoResponseError());
    detectCharger.mockRejectedValueOnce(new Error("The robot cannot look right now."));
    const { wrapper } = setup();
    const { result } = renderHook(() => useChargerDetect("lab"), { wrapper });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ pose: null, answered: false });

    await act(async () => {
      outcome = await result.current.run();
    });
    expect(outcome).toEqual({ pose: null, answered: true });
  });

  it("clear drops a failure", async () => {
    detectCharger.mockRejectedValue(new Error("The robot's camera is not answering."));
    const { wrapper } = setup();
    const { result } = renderHook(() => useChargerDetect("lab"), { wrapper });

    await act(async () => {
      await result.current.run();
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.clear());
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
