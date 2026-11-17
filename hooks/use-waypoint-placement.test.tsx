import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ChargerDetectResult } from "@/lib/api/landmark";
import { FLOOR_GROUND_BELOW_LEVEL_M, type FloorBand } from "@/lib/map/floors";

/**
 * A placement is a stop nobody has named yet. Its pose has three sources and
 * the rules are about which placement an answer may land on: the dialog's
 * form is keyed by the placement, so a source that replaces the pose keeps
 * the key (and the typed name), and a look for the charger that outlives the
 * placement that asked names nothing.
 */

const detectCharger = vi.fn<() => Promise<ChargerDetectResult>>();

vi.mock("@/lib/api/landmark", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/landmark")>()),
  detectCharger,
}));

const { ChargerDetectNoResponseError } = await import("@/lib/api/landmark");
const { useWaypointPlacement } = await import("@/hooks/use-waypoint-placement");

const PRESS = { x: 1, y: 2, theta: 0, z: 0 };
const ROBOT = { x: 5, y: 6, theta: 90, z: 0.4 };
const SIGHTING = { map: "lab", x: 2.4, y: -1.1, z: 0.03, theta: -45 } as ChargerDetectResult;
// dp's 2F (2026-11-17): bodies walked 4.88-5.81 m, the robot's own 5.56 standing by the charger.
const UPPER_FLOOR = {
  name: "2F",
  level: 5.43,
  low: 4.88,
  high: 5.81,
  lo: 4.88,
  hi: Infinity,
} as FloorBand;

function setup(robotPose: typeof ROBOT | null = ROBOT, bands: readonly FloorBand[] = []) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return renderHook(
    () => useWaypointPlacement({ mapName: "lab", robotPose, voxels: null, bands }),
    { wrapper },
  );
}

beforeEach(() => {
  detectCharger.mockReset();
});

describe("useWaypointPlacement", () => {
  it("gives every press its own key, so a typed name never carries to the next stop", () => {
    const { result } = setup();

    act(() => result.current.begin(PRESS, false));
    const first = result.current.placement?.key;
    act(() => result.current.close());
    act(() => result.current.begin(PRESS, true));

    expect(result.current.placement?.key).not.toBe(first);
    expect(result.current.placement?.charger).toBe(true);
  });

  it("takes the robot's position onto the same placement", () => {
    const { result } = setup();
    act(() => result.current.begin(PRESS, true));
    const key = result.current.placement?.key;

    act(() => result.current.takeRobotPose());

    expect(result.current.placement).toMatchObject({
      key,
      charger: true,
      detected: false,
      pose: { x: 5, y: 6, theta: 90 },
    });
  });

  it("leaves the press alone when the robot's position is unknown", () => {
    const { result } = setup(null);
    act(() => result.current.begin(PRESS, false));

    act(() => result.current.takeRobotPose());

    expect(result.current.placement?.pose).toEqual(PRESS);
  });

  it("puts the measured charger on its floor's ground and says it was detected", async () => {
    // The z the robot answers is its body height: it names the floor, it is not the ground.
    detectCharger.mockResolvedValue({ ...SIGHTING, z: 5.56 });
    const { result } = setup(ROBOT, [UPPER_FLOOR]);
    act(() => result.current.begin(PRESS, true));
    const key = result.current.placement?.key;

    await act(async () => result.current.detectCharger());

    expect(result.current.placement).toMatchObject({
      key,
      charger: true,
      detected: true,
      pose: { x: 2.4, y: -1.1, theta: -45 },
    });
    // No tree read here, so the floor's own ground: a body height under its level.
    expect(result.current.placement?.pose.z).toBeCloseTo(5.43 - FLOOR_GROUND_BELOW_LEVEL_M);
  });

  it("does not put an answer on a placement other than the one that asked", async () => {
    let answer: (found: ChargerDetectResult) => void = () => {};
    detectCharger.mockReturnValue(new Promise((resolve) => (answer = resolve)));
    const { result } = setup();
    act(() => result.current.begin(PRESS, true));
    act(() => result.current.detectCharger());

    // The dialog is closed and another stop placed while the robot looks.
    act(() => result.current.close());
    act(() => result.current.begin(PRESS, false));
    await act(async () => answer(SIGHTING));

    expect(result.current.placement?.pose).toEqual(PRESS);
    expect(result.current.placement?.detected).toBeUndefined();
  });

  it("lets go of the placement when the robot never answers", async () => {
    detectCharger.mockRejectedValue(new ChargerDetectNoResponseError());
    const { result } = setup();
    act(() => result.current.begin(PRESS, true));

    await act(async () => result.current.detectCharger());

    expect(result.current.placement).toBeNull();
    expect(result.current.detectError).toBeNull();
  });

  it("keeps the placement and shows the sentence when the robot refuses", async () => {
    detectCharger.mockRejectedValue(new Error("The charger is not in view."));
    const { result } = setup();
    act(() => result.current.begin(PRESS, true));

    await act(async () => result.current.detectCharger());

    await waitFor(() => expect(result.current.detectError).toBe("The charger is not in view."));
    expect(result.current.placement?.pose).toEqual(PRESS);
  });
});
