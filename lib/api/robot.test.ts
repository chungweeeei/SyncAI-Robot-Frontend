import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RobotStateConflictError,
  RobotStateSilentError,
  fetchRobotState,
  robotStateSilence,
  setInitialPose,
  setRobotState,
} from "@/lib/api/robot";

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

/**
 * The state change is the one press that lets the robot drive, so what it
 * sends and how a refusal reads are both rules: the two targets go out as
 * the robot's own words, a coded 409 keeps its code, and anything else is
 * the backend's plain sentence.
 */
describe("setRobotState", () => {
  function answer(body: unknown, status = 200) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  it("posts the target to the state endpoint and returns the robot's answer", async () => {
    answer({ state: "IDLE", message: "Position confirmed." });
    await expect(setRobotState("IDLE")).resolves.toEqual({
      state: "IDLE",
      message: "Position confirmed.",
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new URL(url).pathname).toBe("/api/v1/robot/state");
    expect(init.method).toBe("POST");
    expect(sentBody()).toEqual({ state: "IDLE" });
  });

  it("sends the withdrawal as the robot's word for it", async () => {
    answer({ state: "UNINITIALIZED", message: "Confirmation withdrawn." });
    await setRobotState("UNINITIALIZED");
    expect(sentBody()).toEqual({ state: "UNINITIALIZED" });
  });

  it("takes a resulting state that is not the one asked for", async () => {
    // The rollup: a confirmed robot on its charger answers CHARGING.
    answer({ state: "CHARGING", message: "Position confirmed." });
    await expect(setRobotState("IDLE")).resolves.toMatchObject({ state: "CHARGING" });
  });

  it("keeps a coded refusal's code beside the backend's sentence", async () => {
    for (const code of ["task_running", "tasks_unknown", "not_converged", "robot_state_refused"]) {
      answer({ detail: `refused: ${code}`, code }, 409);
      const error = await setRobotState("IDLE").catch((caught: unknown) => caught);
      expect(error, code).toBeInstanceOf(RobotStateConflictError);
      expect((error as RobotStateConflictError).code).toBe(code);
      expect((error as RobotStateConflictError).message).toBe(`refused: ${code}`);
    }
  });

  it("throws the plain sentence for a refusal it has no code for", async () => {
    answer({ detail: "The robot did not answer." }, 502);
    const down = await setRobotState("IDLE").catch((caught: unknown) => caught);
    expect(down).not.toBeInstanceOf(RobotStateConflictError);
    expect((down as Error).message).toBe("The robot did not answer.");

    answer({ detail: "Something newer.", code: "newer_code" }, 409);
    const newer = await setRobotState("IDLE").catch((caught: unknown) => caught);
    expect(newer).not.toBeInstanceOf(RobotStateConflictError);
    expect((newer as Error).message).toBe("Something newer.");
  });

  it("refuses an answer in another shape, saying the robot already acted", async () => {
    answer({ status: "IDLE" });
    await expect(setRobotState("IDLE")).rejects.toThrow(/robot accepted the request/);
  });
});

/**
 * The frame is only ever the robot's current word: the backend answers 404
 * once the robot stops renewing it. That refusal's sentence is the one a
 * failed read may show an operator, so it has to be told from every other
 * failure — by its code, never its prose.
 */
describe("fetchRobotState", () => {
  function refuse(body: unknown, status: number) {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }

  it("reads a robot that stopped reporting as silent, with the backend's sentence", async () => {
    const sentence = "The robot has not reported its state for 4 seconds.";
    refuse({ detail: sentence, code: "robot_state_stale" }, 404);
    const error = await fetchRobotState().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RobotStateSilentError);
    expect((error as RobotStateSilentError).code).toBe("robot_state_stale");
    expect(robotStateSilence(error as Error)).toBe(sentence);
  });

  it("reads a robot that has not reported yet the same way", async () => {
    refuse({ detail: "Robot state is not available yet.", code: "robot_state_unavailable" }, 404);
    const error = await fetchRobotState().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(RobotStateSilentError);
    expect(robotStateSilence(error as Error)).toBe("Robot state is not available yet.");
  });

  it("still fails on a 404 without a code, as a backend before the codes sends it", async () => {
    refuse({ detail: "Robot state is not available yet." }, 404);
    const error = await fetchRobotState().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(RobotStateSilentError);
  });

  it("has no sentence for an operator in any other failure", async () => {
    // A proxy's page, a dropped connection, a frame in another shape: an
    // engineer's words, which the console does not put on screen.
    refuse({ detail: "Bad Gateway" }, 502);
    const down = await fetchRobotState().catch((caught: unknown) => caught);
    expect(robotStateSilence(down as Error)).toBeNull();
    expect(robotStateSilence(new TypeError("Failed to fetch"))).toBeNull();
    expect(robotStateSilence(null)).toBeNull();
  });
});
