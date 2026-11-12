import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ESTOP_REFUSAL, EstopContext, type ConsoleEstop } from "@/hooks/use-console-estop";
import { mutationKeys } from "@/lib/api/query-keys";
import type { TaskStateResponse } from "@/lib/api/task";

/**
 * Every flow that sends the robot a job goes through here, so these are the
 * rules none of them may lose: nothing is sent while the stop is engaged, a
 * job that was sent is followed, and of the three things that can go wrong
 * the operator is told the one that explains the others.
 */

const cancelTask = vi.fn<(id: string) => Promise<unknown>>();
const fetchTaskState = vi.fn<(id: string) => Promise<TaskStateResponse>>();

vi.mock("@/lib/api/task", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api/task")>()),
  cancelTask,
  fetchTaskState,
}));

const { useTrackedDispatch } = await import("@/hooks/use-tracked-dispatch");

function setup({ engaged = false }: { engaged?: boolean } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const estop = { engaged } as ConsoleEstop;
  const dispatch = vi.fn<(variables: string) => Promise<string>>();
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>
      <EstopContext.Provider value={estop}>{children}</EstopContext.Provider>
    </QueryClientProvider>
  );
  const hook = renderHook(() => useTrackedDispatch({ kind: "task", dispatch }), { wrapper });
  return { client, dispatch, ...hook };
}

function state(id: string, status: string, error = ""): TaskStateResponse {
  return { id, status, steps: [{ id: "1-move", status, error_msg: error }] } as TaskStateResponse;
}

beforeEach(() => {
  cancelTask.mockReset();
  fetchTaskState.mockReset();
});

describe("useTrackedDispatch", () => {
  it("sends nothing while the stop is engaged, and says why", async () => {
    const { result, dispatch } = setup({ engaged: true });

    await act(async () => result.current.submit("round"));

    await waitFor(() => expect(result.current.refused).toBe(ESTOP_REFUSAL));
    expect(dispatch).not.toHaveBeenCalled();
    expect(result.current.error).toBe(ESTOP_REFUSAL);
    expect(result.current.task.taskStatus).toBeNull();
  });

  it("follows the job the backend answered with, under the key the masthead reads", async () => {
    fetchTaskState.mockResolvedValue(state("job-1", "IN_PROGRESS"));
    const { result, dispatch, client } = setup();
    dispatch.mockResolvedValue("job-1");

    await act(async () => result.current.submit("round"));

    await waitFor(() => expect(result.current.task.taskId).toBe("job-1"));
    await waitFor(() => expect(result.current.task.taskStatus).toBe("IN_PROGRESS"));
    const sent = client.getMutationCache().findAll({ mutationKey: mutationKeys.taskDispatch });
    expect(sent).toHaveLength(1);
    expect(sent[0].options.meta).toEqual({ kind: "task" });
  });

  it("says why the job closed, not that its cancel was refused", async () => {
    fetchTaskState.mockResolvedValue(state("job-1", "IN_PROGRESS"));
    cancelTask.mockRejectedValue(new Error("The job has already ended."));
    const { result, dispatch } = setup();
    dispatch.mockResolvedValue("job-1");
    await act(async () => result.current.submit("round"));
    await waitFor(() => expect(result.current.task.cancelable).toBe(true));

    await act(async () => result.current.cancel());
    await waitFor(() => expect(result.current.error).toBe("The job has already ended."));

    // The next read says the job failed on its own: that is the answer.
    fetchTaskState.mockResolvedValue(state("job-1", "FAILED", "No route to the waypoint."));
    await waitFor(() => expect(result.current.task.taskStatus).toBe("FAILED"), { timeout: 3000 });
    expect(result.current.error).not.toBe("The job has already ended.");
    expect(result.current.error).not.toBeNull();
    expect(result.current.refused).toBeNull();
  });

  it("forgets the run and both requests' errors on clear", async () => {
    const { result, dispatch } = setup();
    dispatch.mockRejectedValue(new Error("The robot is on another map."));
    await act(async () => result.current.submit("round"));
    await waitFor(() => expect(result.current.error).toBe("The robot is on another map."));

    act(() => result.current.clear());

    await waitFor(() => expect(result.current.error).toBeNull());
    expect(result.current.task.taskStatus).toBeNull();
  });
});
