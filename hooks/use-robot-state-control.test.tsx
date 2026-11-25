import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/api/query-keys";
import type { RobotState } from "@/lib/types/robot";

/**
 * The robot's state as a control. Three rules live in the hooks rather than
 * in lib/robot/readiness.ts: a press makes the robot's frame stale (or the
 * console offers Confirm after the robot has taken it), a backend from
 * before the state machine draws and locks nothing, and a job is only called
 * stuck once it has looked stuck for a while.
 */

const fetchRobotState = vi.fn<() => Promise<RobotState>>();
const setRobotState = vi.fn();

vi.mock("@/lib/api/robot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/robot")>()),
  fetchRobotState,
  setRobotState,
}));

const { useRobotStateControl, useSetRobotState } = await import(
  "@/hooks/use-robot-state-control"
);
const { useStartLock } = await import("@/hooks/use-start-lock");
const { START_LOCK_ERROR, START_LOCK_SILENT, START_LOCK_UNCONFIRMED, STUCK_JOB_AFTER_MS } = await import(
  "@/lib/robot/readiness"
);

function frame(over: Partial<RobotState>, timestamp = 1): RobotState {
  return { robot_id: "robot01", mode: "AUTO", timestamp, ...over } as RobotState;
}

const jobs = (count: number, asOf = "t1") => ({
  tasks: Array.from({ length: count }, (_, index) => ({ id: `job-${index}`, map_name: null })),
  recently_ended: [],
  as_of: asOf,
});

/**
 * One turn of the console's poll, answered by `fetchRobotState`'s mock: a
 * failure leaves the last frame in the cache, as the real poll's does.
 */
async function poll(client: QueryClient) {
  await act(async () => {
    await client
      .fetchQuery({ queryKey: queryKeys.robotState, queryFn: fetchRobotState, staleTime: 0 })
      .catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

/** TanStack notifies its observers on a timer, so a cache write lands a tick later. */
async function write(client: QueryClient, key: readonly unknown[], data: unknown) {
  await act(async () => {
    client.setQueryData(key, data);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

beforeEach(() => {
  fetchRobotState.mockReset();
  setRobotState.mockReset();
});

describe("useSetRobotState", () => {
  it("makes the robot's frame stale, since every lock is read off it", async () => {
    setRobotState.mockResolvedValue({ state: "IDLE", message: "Position confirmed." });
    const { client, wrapper } = setup();
    const invalidated: unknown[] = [];
    vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
      invalidated.push(filters?.queryKey);
    });
    const { result } = renderHook(() => useSetRobotState(), { wrapper });

    await act(() => result.current.mutateAsync("IDLE"));

    expect(setRobotState).toHaveBeenCalledWith("IDLE");
    expect(invalidated).toEqual([queryKeys.robotState]);
  });

  it("leaves the frame alone when the robot refused: nothing changed", async () => {
    setRobotState.mockRejectedValue(new Error("The robot is running a job."));
    const { client, wrapper } = setup();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const { result } = renderHook(() => useSetRobotState(), { wrapper });

    await act(() => result.current.mutateAsync("IDLE").catch(() => {}));

    expect(invalidate).not.toHaveBeenCalled();
  });
});

describe("useStartLock", () => {
  it("locks nothing before the first frame", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useStartLock(true), { wrapper });
    expect(result.current).toEqual({ locked: false, reason: null });
  });

  it("locks nothing on a frame from before the state machine", () => {
    // No `localization_converged`: UNINITIALIZED there refused no job.
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.robotState, frame({ state: "UNINITIALIZED" }));
    const { result } = renderHook(() => useStartLock(true), { wrapper });
    expect(result.current.locked).toBe(false);
  });

  it("holds a driving job on an unconfirmed robot and lets the rest run", () => {
    const { client, wrapper } = setup();
    client.setQueryData(
      queryKeys.robotState,
      frame({ state: "UNINITIALIZED", localization_converged: true }),
    );
    const driving = renderHook(() => useStartLock(true), { wrapper });
    const standing = renderHook(() => useStartLock(false), { wrapper });

    expect(driving.result.current).toEqual({ locked: true, reason: START_LOCK_UNCONFIRMED });
    expect(standing.result.current.locked).toBe(false);
  });

  it("follows the robot's state without asking the robot itself", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.robotState, frame({ state: "IDLE", localization_converged: true }));
    const { result } = renderHook(() => useStartLock(false), { wrapper });
    expect(result.current.locked).toBe(false);

    await write(
      client,
      queryKeys.robotState,
      frame({ state: "ERROR", localization_converged: true }, 2),
    );

    expect(result.current).toEqual({ locked: true, reason: START_LOCK_ERROR });
    expect(fetchRobotState).not.toHaveBeenCalled();
  });

  it("goes on judging by the last frame through a failing poll, as every gate here does", async () => {
    // A hold the robot last reported stays; a press the last frame allowed
    // goes through, and the robot's own refusal answers it.
    const { client, wrapper } = setup();
    client.setQueryData(
      queryKeys.robotState,
      frame({ state: "UNINITIALIZED", localization_converged: true }),
    );
    const held = renderHook(() => useStartLock(true), { wrapper });
    const free = renderHook(() => useStartLock(false), { wrapper });

    fetchRobotState.mockRejectedValue(new Error("The robot has not reported its state."));
    await poll(client);

    // The hold stands; its reason no longer repeats the last frame's word.
    expect(held.result.current).toEqual({ locked: true, reason: START_LOCK_SILENT });
    expect(free.result.current.locked).toBe(false);

    fetchRobotState.mockResolvedValue(
      frame({ state: "UNINITIALIZED", localization_converged: true }, 2),
    );
    await poll(client);
    expect(held.result.current).toEqual({ locked: true, reason: START_LOCK_UNCONFIRMED });
  });

  it("keeps its answer, and its caller's render, across a frame that only moved the clock", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.robotState, frame({ state: "IDLE", localization_converged: true }));
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useStartLock(true);
      },
      { wrapper },
    );
    const before = result.current;
    const settled = renders;

    await write(client, queryKeys.robotState, frame({ state: "IDLE", localization_converged: true }, 2));
    await write(client, queryKeys.robotState, frame({ state: "IDLE", localization_converged: true }, 3));

    expect(result.current).toBe(before);
    expect(renders).toBe(settled);
  });
});

describe("useRobotStateControl", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws nothing for a backend from before the state machine", () => {
    // Its UNINITIALIZED is another fact, and it has no Confirm to offer.
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.robotState, frame({ state: "UNINITIALIZED" }));
    client.setQueryData(queryKeys.activeTasks, jobs(0));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });

    expect(result.current.state).toBeNull();
    expect(result.current.action).toBeNull();
    expect(result.current.confirmOffered).toBe(false);
  });

  it("withholds the state and every control while the robot is not reporting it", async () => {
    const { client, wrapper } = setup();
    const unconfirmed = frame({
      state: "UNINITIALIZED",
      localization_converged: true,
      state_message: "Waiting for an operator to confirm the position.",
    });
    client.setQueryData(queryKeys.robotState, unconfirmed);
    client.setQueryData(queryKeys.activeTasks, jobs(0));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });
    expect(result.current.action).not.toBeNull();
    expect(result.current.silent).toBe(false);

    // The poll fails; the cache still holds the frame above.
    fetchRobotState.mockRejectedValue(new Error("The robot has not reported its state."));
    await poll(client);

    expect(client.getQueryData(queryKeys.robotState)).toEqual(unconfirmed);
    expect(result.current.silent).toBe(true);
    expect(result.current.state).toBeNull();
    expect(result.current.message).toBe("");
    expect(result.current.action).toBeNull();
    expect(result.current.confirmOffered).toBe(false);
    // The dashboard's panel stays, held: it was owed when the robot went quiet.
    expect(result.current.confirmPanel).toBe("silent");

    // Frames resume, and it all comes back.
    fetchRobotState.mockResolvedValue({ ...unconfirmed, timestamp: 2 });
    await poll(client);

    expect(result.current.silent).toBe(false);
    expect(result.current.state).toBe("UNINITIALIZED");
    expect(result.current.confirmOffered).toBe(true);
    expect(result.current.confirmPanel).toBe("live");
    expect(result.current.action?.id).toBe("confirm");
  });

  it("is not silent, only absent, before any frame or on a backend without the state machine", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.activeTasks, jobs(0));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });
    fetchRobotState.mockRejectedValue(new Error("Robot state is not available yet."));
    await poll(client);
    expect(result.current.silent).toBe(false);
    expect(result.current.state).toBeNull();

    fetchRobotState.mockResolvedValue(frame({ state: "IDLE" }));
    await poll(client);
    fetchRobotState.mockRejectedValue(new Error("gone"));
    await poll(client);
    expect(result.current.silent).toBe(false);
    expect(result.current.state).toBeNull();
  });

  it("offers Confirm on an unconfirmed robot, with the robot's own sentence", () => {
    const { client, wrapper } = setup();
    client.setQueryData(
      queryKeys.robotState,
      frame({
        state: "UNINITIALIZED",
        localization_converged: true,
        state_message: "Waiting for an operator to confirm the position.",
      }),
    );
    client.setQueryData(queryKeys.activeTasks, jobs(0));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });

    expect(result.current.state).toBe("UNINITIALIZED");
    expect(result.current.message).toBe("Waiting for an operator to confirm the position.");
    expect(result.current.confirmOffered).toBe(true);
    expect(result.current.action).toMatchObject({ id: "confirm", lock: null });
  });

  it("shows the robot's answer only while it reports the state the answer named", async () => {
    setRobotState.mockResolvedValue({ state: "IDLE", message: "Position confirmed." });
    const { client, wrapper } = setup();
    // The invalidation would refetch through the mocked reader; the test
    // moves the frame by hand instead.
    vi.spyOn(client, "invalidateQueries").mockResolvedValue();
    client.setQueryData(
      queryKeys.robotState,
      frame({ state: "UNINITIALIZED", localization_converged: true }),
    );
    client.setQueryData(queryKeys.activeTasks, jobs(0));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });

    act(() => result.current.apply("IDLE"));
    await waitFor(() => expect(setRobotState).toHaveBeenCalledWith("IDLE"));
    // The frame still says unconfirmed: a request is not a reading.
    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(result.current.receipt).toBeNull();

    await write(client, queryKeys.robotState, frame({ state: "IDLE", localization_converged: true }, 2));
    expect(result.current.receipt).toBe("Position confirmed.");

    await write(client, queryKeys.robotState, frame({ state: "RUNNING", localization_converged: true }, 3));
    expect(result.current.receipt).toBeNull();
  });

  it("hands a refusal up as the backend's sentence", async () => {
    setRobotState.mockRejectedValue(new Error("The robot has not found its position yet."));
    const { client, wrapper } = setup();
    client.setQueryData(
      queryKeys.robotState,
      frame({ state: "UNINITIALIZED", localization_converged: true }),
    );
    client.setQueryData(queryKeys.activeTasks, jobs(0));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });

    act(() => result.current.apply("IDLE"));

    await waitFor(() =>
      expect(result.current.error).toBe("The robot has not found its position yet."),
    );
  });

  it("calls a job stuck only after it has looked stuck for a while", () => {
    vi.useFakeTimers();
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.robotState, frame({ state: "RUNNING", localization_converged: true }));
    client.setQueryData(queryKeys.activeTasks, jobs(0));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });

    // A job seen by one poll and not yet the other looks the same at first.
    expect(result.current.stuck).toBe(false);
    expect(result.current.action).toBeNull();

    act(() => {
      vi.advanceTimersByTime(STUCK_JOB_AFTER_MS - 1);
    });
    expect(result.current.stuck).toBe(false);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.stuck).toBe(true);
    expect(result.current.action).toMatchObject({ id: "clear-stuck", target: "IDLE" });
  });

  it("never calls a job stuck that the list has, however long it runs", () => {
    vi.useFakeTimers();
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.robotState, frame({ state: "RUNNING", localization_converged: true }));
    client.setQueryData(queryKeys.activeTasks, jobs(1));
    const { result } = renderHook(() => useRobotStateControl(), { wrapper });

    act(() => {
      vi.advanceTimersByTime(STUCK_JOB_AFTER_MS * 10);
    });

    expect(result.current.stuck).toBe(false);
    expect(result.current.action).toBeNull();
  });
});
