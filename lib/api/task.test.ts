import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  fetchActiveTasks,
  fetchTaskState,
  pauseTask,
  resumeTask,
  sendMoveTask,
} from "@/lib/api/task";

/**
 * The dispatch ack is the one write whose answer the console cannot do without:
 * its `id` becomes the tracker's query key and poll target. An ack that lost
 * the field used to arrive as `undefined` and start a 1 Hz poll of
 * `/tasks/undefined` that nothing would ever stop.
 *
 * The hold routes are the opposite case: their ack is a claim the console
 * deliberately does not read, so what is pinned is the path they post to and
 * that a refusal arrives as the backend's own sentence.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ack(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const GOAL = { x: 1, y: 2, theta: 90 };

describe("sendMoveTask", () => {
  it("resolves to the id the backend acknowledged", async () => {
    fetchMock.mockResolvedValue(
      ack({ id: "robot01-goal-1", status: "PENDING", message: "Task accepted" }),
    );
    await expect(sendMoveTask("robot01", GOAL)).resolves.toBe("robot01-goal-1");
  });

  it("refuses an ack with no id rather than handing the tracker undefined", async () => {
    fetchMock.mockResolvedValue(ack({ status: "PENDING", message: "Task accepted" }));
    await expect(sendMoveTask("robot01", GOAL)).rejects.toThrow(/id/);
  });

  it("says the robot has the task, so a retry is not the obvious next step", async () => {
    fetchMock.mockResolvedValue(ack({ task_id: "robot01-goal-1", status: "PENDING" }));
    await expect(sendMoveTask("robot01", GOAL)).rejects.toThrow(
      /accepted the request/,
    );
  });

  it("keeps working when the backend adds a field to the ack", async () => {
    fetchMock.mockResolvedValue(
      ack({ id: "robot01-goal-1", status: "PENDING", message: "ok", queued_at: 1 }),
    );
    await expect(sendMoveTask("robot01", GOAL)).resolves.toBe("robot01-goal-1");
  });
});

describe("pauseTask / resumeTask", () => {
  const ID = "robot01-task-1758000000-1";

  it("posts to the run's own pause and resume routes", async () => {
    fetchMock.mockResolvedValue(ack({ id: ID, status: "PAUSING", message: "" }));
    await expect(pauseTask(ID)).resolves.toBeUndefined();
    await expect(resumeTask(ID)).resolves.toBeUndefined();
    const calls = fetchMock.mock.calls.map(([url, init]) => [
      String(url).replace(/^https?:\/\/[^/]+/, ""),
      (init as RequestInit).method,
    ]);
    expect(calls).toEqual([
      [`/api/v1/tasks/${ID}/pause`, "POST"],
      [`/api/v1/tasks/${ID}/resume`, "POST"],
    ]);
  });

  it("escapes an id that would otherwise rewrite the route", async () => {
    fetchMock.mockResolvedValue(ack({ id: "a/b", status: "PAUSING", message: "" }));
    await pauseTask("a/b");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/tasks/a%2Fb/pause");
  });

  it("resolves whatever the ack says, because the ack is not the reading", async () => {
    fetchMock.mockResolvedValue(ack({ anything: true }));
    await expect(pauseTask(ID)).resolves.toBeUndefined();
  });

  it("rejects with the backend's sentence once the run has closed", async () => {
    fetchMock.mockResolvedValue(
      ack({ detail: `Task ${ID} is not running`, code: "task_not_running" }, 409),
    );
    await expect(pauseTask(ID)).rejects.toThrow(`Task ${ID} is not running`);
  });
});

describe("fetchTaskState", () => {
  it("accepts a held run and a held step", async () => {
    fetchMock.mockResolvedValue(
      ack({
        id: "t",
        status: "PAUSED",
        steps: [{ id: "2-move", status: "PAUSED", error_msg: "" }],
      }),
    );
    await expect(fetchTaskState("t")).resolves.toMatchObject({
      status: "PAUSED",
      steps: [{ status: "PAUSED" }],
    });
  });
});

describe("fetchActiveTasks", () => {
  const entry = {
    id: "t",
    run_id: "r",
    status: "IN_PROGRESS",
    started_at: "2026-09-18T09:44:30Z",
    source: "DIRECT",
    schedule_id: null,
  };

  it("reads the kind and name the backend stamps on a run", async () => {
    fetchMock.mockResolvedValue(
      ack({
        tasks: [{ ...entry, kind: "task", name: "Morning round", map_name: "dp2f" }],
        as_of: "2026-09-18T09:45:00Z",
      }),
    );
    const { tasks } = await fetchActiveTasks();
    expect(tasks[0]).toMatchObject({ kind: "task", name: "Morning round" });
  });

  it("still parses a backend that sends neither, as nulls", async () => {
    fetchMock.mockResolvedValue(
      ack({ tasks: [entry], as_of: "2026-09-18T09:45:00Z" }),
    );
    const { tasks } = await fetchActiveTasks();
    expect(tasks[0]).toMatchObject({ kind: null, name: null, map_name: null });
  });
});
