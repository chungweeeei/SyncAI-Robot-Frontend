import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/lib/api/query-keys";
import type { RobotState } from "@/lib/types/robot";

/**
 * A selector is how a screen reads one thing off the console's 1 Hz frame
 * without being re-rendered by the rest of it. Two rules make that worth
 * having: it never asks the robot itself (the provider's poll is the one
 * request), and a frame that changed something else is not its news.
 */

const fetchRobotState = vi.fn<() => Promise<RobotState>>();

vi.mock("@/lib/api/robot", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/robot")>()),
  fetchRobotState,
}));

const { useRobotId, useRobotStateStatus } = await import("@/hooks/use-console-robot-state");
const { useMapRunLock } = await import("@/hooks/use-map-run-lock");
const { RUN_LOCK_RUNNING, RUN_LOCK_UNKNOWN } = await import("@/lib/map/run-lock");

function frame(timestamp: number): RobotState {
  return { robot_id: "robot01", timestamp } as unknown as RobotState;
}

/** TanStack notifies its observers on a timer, so a cache write lands a tick later. */
async function write(client: QueryClient, key: readonly unknown[], data: unknown) {
  await act(async () => {
    client.setQueryData(key, data);
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  fetchRobotState.mockReset();
});

describe("useRobotId", () => {
  it("reads the provider's entry and asks the robot nothing itself", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useRobotId(), { wrapper });
    expect(result.current).toBeNull();

    await write(client, queryKeys.robotState, frame(1));

    expect(result.current).toBe("robot01");
    expect(fetchRobotState).not.toHaveBeenCalled();
  });

  it("does not re-render for a frame that only moved the clock", async () => {
    const { client, wrapper } = setup();
    let renders = 0;
    renderHook(
      () => {
        renders += 1;
        return useRobotId();
      },
      { wrapper },
    );
    await write(client, queryKeys.robotState, frame(1));
    const settled = renders;

    await write(client, queryKeys.robotState, frame(2));
    await write(client, queryKeys.robotState, frame(3));

    expect(renders).toBe(settled);
  });
});

describe("useRobotStateStatus", () => {
  it("is loading until the provider's first frame lands", async () => {
    const { client, wrapper } = setup();
    const { result } = renderHook(() => useRobotStateStatus(), { wrapper });
    expect(result.current).toBe("loading");

    await write(client, queryKeys.robotState, frame(1));

    expect(result.current).toBe("ok");
  });
});

describe("useMapRunLock", () => {
  const listing = (maps: (string | null)[], asOf: string) => ({
    tasks: maps.map((map_name, index) => ({ id: `job-${index}`, map_name })),
    recently_ended: [],
    as_of: asOf,
  });

  it("fails closed before the list has been read", () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useMapRunLock("lab"), { wrapper });
    expect(result.current).toEqual({ locked: true, reason: RUN_LOCK_UNKNOWN });
  });

  it("locks the map a running job names, and only that one", () => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.activeTasks, listing(["lab"], "t1"));

    const lab = renderHook(() => useMapRunLock("lab"), { wrapper });
    const yard = renderHook(() => useMapRunLock("yard"), { wrapper });

    expect(lab.result.current).toEqual({ locked: true, reason: RUN_LOCK_RUNNING });
    expect(yard.result.current).toEqual({ locked: false, reason: null });
  });

  it("keeps its answer, and its caller's render, across a read that changed nothing here", async () => {
    const { client, wrapper } = setup();
    client.setQueryData(queryKeys.activeTasks, listing([], "t1"));
    let renders = 0;
    const { result } = renderHook(
      () => {
        renders += 1;
        return useMapRunLock("lab");
      },
      { wrapper },
    );
    const before = result.current;
    const settled = renders;

    // The list's clock moves on every read.
    await write(client, queryKeys.activeTasks, listing([], "t2"));

    expect(result.current).toBe(before);
    expect(renders).toBe(settled);
  });
});
