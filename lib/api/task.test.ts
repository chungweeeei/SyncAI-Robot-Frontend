import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendMoveTask } from "@/lib/api/task";

/**
 * The dispatch ack is the one write whose answer the console cannot do without:
 * its `id` becomes the tracker's query key and poll target. An ack that lost
 * the field used to arrive as `undefined` and start a 1 Hz poll of
 * `/tasks/undefined` that nothing would ever stop.
 */

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function ack(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
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
