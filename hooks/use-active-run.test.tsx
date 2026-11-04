import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseActiveTasks } from "@/hooks/use-active-tasks";
import { ActiveTaskContext } from "@/hooks/use-console-active-tasks";
import { mutationKeys } from "@/lib/api/query-keys";
import type { ActiveTask, TaskStateResponse, TaskStatus } from "@/lib/api/task";
import { ENDED_RUN_LINGER_MS } from "@/lib/task/run";

/**
 * The bar keeps a run that has just ended for a moment, so "Completed" can be
 * read, without the active list itself (which locks maps and refreshes the
 * history) meaning anything but "running now". What may never happen is the
 * memory standing in for a reading: over a failing list, over the next run,
 * or for a run no read has said is closed.
 */

const ID = "robot01-task-1758000000-1";

/** What GET /tasks/<id> answers, by id; the test moves it. */
const states = new Map<string, TaskStatus>();
const reads: string[] = [];

vi.mock("@/lib/api/task", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/task")>()),
  fetchTaskState: vi.fn(async (id: string): Promise<TaskStateResponse> => {
    reads.push(id);
    const status = states.get(id) ?? "IN_PROGRESS";
    return {
      id,
      status,
      steps: [{ id: "1-move", status, error_msg: "" }],
    } as TaskStateResponse;
  }),
}));

const { useActiveRun } = await import("@/hooks/use-active-run");

function activeTask(id = ID): ActiveTask {
  return {
    id,
    run_id: "run-1",
    status: "IN_PROGRESS",
    started_at: "2026-09-18T09:44:30Z",
    source: "DIRECT",
    schedule_id: null,
    kind: "task",
    name: "Morning round",
    map_name: "dp2f",
  } as ActiveTask;
}

function setup(tasks: ActiveTask[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let list: UseActiveTasks = { tasks, status: "ok", asOf: null, refresh: () => {} };
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <ActiveTaskContext.Provider value={list}>{children}</ActiveTaskContext.Provider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useActiveRun(), { wrapper });
  const listing = (next: Partial<UseActiveTasks>) => {
    list = { ...list, ...next };
    hook.rerender();
  };
  /** What a Run on /tasks leaves in the cache once the backend acked it. */
  const dispatch = (id: string, name: string | null = "Morning round") =>
    act(() =>
      client
        .getMutationCache()
        .build(client, {
          mutationKey: mutationKeys.taskDispatch,
          meta: { kind: "task" },
          mutationFn: async () => id,
        })
        .execute({ name }),
    );
  return { ...hook, listing, dispatch };
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  states.clear();
  reads.length = 0;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useActiveRun's ended run", () => {
  it("keeps a run read as closed for the linger after the list drops it, then lets go", async () => {
    const { result, listing } = setup([activeTask()]);
    await waitFor(() => expect(result.current.run?.status).toBe("IN_PROGRESS"));

    states.set(ID, "COMPLETED");
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await waitFor(() => expect(result.current.run?.status).toBe("COMPLETED"));

    listing({ tasks: [] });
    expect(result.current.run).toBeNull();
    expect(result.current.ended?.task.id).toBe(ID);
    expect(result.current.ended?.status).toBe("COMPLETED");

    await act(() => vi.advanceTimersByTimeAsync(ENDED_RUN_LINGER_MS));
    expect(result.current.ended).toBeNull();
  });

  it("reads a run the list dropped first once more, and keeps it only once the read says it closed", async () => {
    const { result, listing } = setup([activeTask()]);
    await waitFor(() => expect(result.current.run?.status).toBe("IN_PROGRESS"));
    const before = reads.length;

    states.set(ID, "FAILED");
    listing({ tasks: [] });

    await waitFor(() => expect(result.current.ended?.status).toBe("FAILED"));
    expect(reads.length).toBe(before + 1);

    // One read, not a poll: a run off the list has nothing left to report.
    await act(() => vi.advanceTimersByTimeAsync(ENDED_RUN_LINGER_MS + 2_000));
    expect(reads.length).toBe(before + 1);
    expect(result.current.ended).toBeNull();
  });

  it("shows nothing for a run whose last read did not say it closed", async () => {
    const { result, listing } = setup([activeTask()]);
    await waitFor(() => expect(result.current.run?.status).toBe("IN_PROGRESS"));

    listing({ tasks: [] });
    await waitFor(() => expect(reads.length).toBeGreaterThan(1));
    await act(() => vi.advanceTimersByTimeAsync(100));
    expect(result.current.ended).toBeNull();
  });

  it("gives way at once to the next run", async () => {
    states.set(ID, "COMPLETED");
    const { result, listing } = setup([activeTask()]);
    await waitFor(() => expect(result.current.run?.status).toBe("COMPLETED"));
    listing({ tasks: [] });
    expect(result.current.ended).not.toBeNull();

    listing({ tasks: [activeTask("robot01-task-1758000100-1")] });
    expect(result.current.ended).toBeNull();
    expect(result.current.run?.task.id).toBe("robot01-task-1758000100-1");
  });

  it("is never drawn over a list that cannot be read", async () => {
    states.set(ID, "COMPLETED");
    const { result, listing } = setup([activeTask()]);
    await waitFor(() => expect(result.current.run?.status).toBe("COMPLETED"));

    listing({ status: "error" });
    expect(result.current.run).toBeNull();
    expect(result.current.ended).toBeNull();
  });

  it("lets go at once when the list lagged past the linger", async () => {
    states.set(ID, "CANCELED");
    const { result, listing } = setup([activeTask()]);
    await waitFor(() => expect(result.current.run?.status).toBe("CANCELED"));

    await act(() => vi.advanceTimersByTimeAsync(ENDED_RUN_LINGER_MS + 1_000));
    listing({ tasks: [] });
    expect(result.current.ended).toBeNull();
  });
});

describe("useActiveRun and a job this console sent", () => {
  it("shows how a job closed that failed before the list could show it", async () => {
    states.set(ID, "FAILED");
    const { result, dispatch } = setup([]);
    await dispatch(ID);

    await waitFor(() => expect(result.current.ended?.status).toBe("FAILED"));
    expect(result.current.run).toBeNull();
    expect(result.current.ended?.task.name).toBe("Morning round");
    expect(result.current.ended?.task.kind).toBe("task");

    await act(() => vi.advanceTimersByTimeAsync(ENDED_RUN_LINGER_MS));
    expect(result.current.ended).toBeNull();
  });

  it("reads an unlisted job until a read says it closed", async () => {
    const { result, dispatch } = setup([]);
    await dispatch(ID);
    await waitFor(() => expect(reads).toContain(ID));
    expect(result.current.ended).toBeNull();

    states.set(ID, "FAILED");
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await waitFor(() => expect(result.current.ended?.status).toBe("FAILED"));
  });

  it("does not bring a job back once another run has had the bar", async () => {
    states.set(ID, "FAILED");
    const { result, listing, dispatch } = setup([]);
    await dispatch(ID);
    await waitFor(() => expect(result.current.ended?.status).toBe("FAILED"));

    const next = "robot01-task-1758000100-1";
    states.set(next, "COMPLETED");
    listing({ tasks: [activeTask(next)] });
    await waitFor(() => expect(result.current.run?.status).toBe("COMPLETED"));
    listing({ tasks: [] });
    expect(result.current.ended?.task.id).toBe(next);

    await act(() => vi.advanceTimersByTimeAsync(ENDED_RUN_LINGER_MS));
    expect(result.current.ended).toBeNull();
  });

  it("is never drawn over a list that cannot be read", async () => {
    states.set(ID, "FAILED");
    const { result, listing, dispatch } = setup([]);
    listing({ status: "error" });
    await dispatch(ID);
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(result.current.ended).toBeNull();
    expect(reads).not.toContain(ID);
  });
});
