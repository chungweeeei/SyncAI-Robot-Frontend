import { describe, expect, it } from "vitest";

import type { TaskStepState } from "@/lib/api/task";
import {
  currentStep,
  holdOffered,
  pauseOffered,
  requestedHold,
  runClosed,
  runElapsed,
  runPhase,
  runState,
  stepLabel,
  stepProgress,
  type HoldRequestView,
} from "@/lib/task/run";

/**
 * The boundaries these guard: the masthead names the step the robot is on
 * from a read that carries only ids, offers a Pause only where one does
 * something, and never shows a request as if it were a reading.
 */

function step(id: string, status: TaskStepState["status"]): TaskStepState {
  return { id, status, error_msg: "" };
}

describe("currentStep", () => {
  it("is the first step held or in progress", () => {
    const steps = [
      step("1-move", "COMPLETED"),
      step("2-speak", "IN_PROGRESS"),
      step("3-move", "PENDING"),
    ];
    expect(currentStep(steps)).toEqual({ index: 1, step: steps[1] });
  });

  it("counts a paused step as the current one", () => {
    const steps = [step("1-move", "COMPLETED"), step("2-move", "PAUSED")];
    expect(currentStep(steps)?.index).toBe(1);
  });

  it("has nothing to say about a list with no live step", () => {
    expect(currentStep([])).toBeNull();
    expect(currentStep([step("1-move", "PENDING")])).toBeNull();
    expect(currentStep([step("1-move", "COMPLETED")])).toBeNull();
  });
});

describe("stepLabel", () => {
  it("reads a composer step as its type's label", () => {
    expect(stepLabel("1-move")).toBe("Move");
    expect(stepLabel("2-speak")).toBe("Speak");
    expect(stepLabel("5-wait")).toBe("Wait");
    expect(stepLabel("12-standup")).toBe("Stand");
    expect(stepLabel("3-liedown")).toBe("Lie");
  });

  it("reads a single-gesture step as the dashboard's word for it", () => {
    expect(stepLabel("goal")).toBe("Navigation goal");
    expect(stepLabel("standup")).toBe("Stand");
    expect(stepLabel("liedown")).toBe("Lie down");
  });

  it("shows another client's id verbatim rather than guessing a type", () => {
    expect(stepLabel("move-to-dock")).toBe("move-to-dock");
    expect(stepLabel("4-teleport")).toBe("4-teleport");
  });
});

describe("stepProgress", () => {
  it("numbers the live step against the whole list", () => {
    expect(
      stepProgress([
        step("1-move", "COMPLETED"),
        step("2-speak", "PAUSED"),
        step("3-move", "PENDING"),
      ]),
    ).toEqual({ ordinal: 2, total: 3, label: "Speak" });
  });

  it("is null when no step is live", () => {
    expect(stepProgress([])).toBeNull();
  });
});

describe("pauseOffered", () => {
  it("never offers a hold on a one-step posture", () => {
    expect(pauseOffered("standup")).toBe(false);
    expect(pauseOffered("liedown")).toBe(false);
  });

  it("offers one on anything that moves, and on a kind it does not know", () => {
    expect(pauseOffered("goal")).toBe(true);
    expect(pauseOffered("task")).toBe(true);
    expect(pauseOffered("schedule")).toBe(true);
    expect(pauseOffered(null)).toBe(true);
  });
});

describe("holdOffered", () => {
  it("keeps the button while the run's read is unknown or live", () => {
    expect(holdOffered("task", null)).toBe(true);
    expect(holdOffered("task", "IN_PROGRESS")).toBe(true);
    expect(holdOffered("task", "PAUSED")).toBe(true);
  });

  it("drops it once the read says the run has closed", () => {
    expect(holdOffered("task", "COMPLETED")).toBe(false);
    expect(holdOffered("goal", "CANCELED")).toBe(false);
  });

  it("never offers it on a posture, whatever the read", () => {
    expect(holdOffered("standup", "IN_PROGRESS")).toBe(false);
  });
});

describe("runPhase", () => {
  it("is running until a read says otherwise", () => {
    expect(runPhase("IN_PROGRESS", null)).toBe("running");
    expect(runPhase(null, null)).toBe("running");
  });

  it("is pausing while a pause was accepted and the read still says running", () => {
    expect(runPhase("IN_PROGRESS", "pause")).toBe("pausing");
    expect(runPhase(null, "pause")).toBe("pausing");
  });

  it("is paused, not pausing, once the read confirms the hold", () => {
    expect(runPhase("PAUSED", "pause")).toBe("paused");
    expect(runPhase("PAUSED", null)).toBe("paused");
  });

  it("is resuming while a resume was accepted and the read still says paused", () => {
    expect(runPhase("PAUSED", "resume")).toBe("resuming");
    expect(runPhase("IN_PROGRESS", "resume")).toBe("running");
  });
});

describe("runState", () => {
  it("names an ending, which runPhase cannot", () => {
    expect(runState("COMPLETED", null)).toBe("completed");
    expect(runState("FAILED", null)).toBe("failed");
    expect(runState("CANCELED", null)).toBe("canceled");
  });

  it("reads the ending over a hold this console asked for", () => {
    // The run was canceled from somewhere else after this tab's pause was
    // accepted. "Pausing…" over a job that has already stopped would be a
    // claim the reading has contradicted.
    expect(runState("CANCELED", "pause")).toBe("canceled");
  });

  it("is the phase for a run that is still going", () => {
    expect(runState("IN_PROGRESS", null)).toBe("running");
    expect(runState("IN_PROGRESS", "pause")).toBe("pausing");
    expect(runState("PAUSED", null)).toBe("paused");
    expect(runState("PAUSED", "resume")).toBe("resuming");
  });
});

describe("runClosed", () => {
  it("is true only for the three ways a run ends", () => {
    expect(runClosed("completed")).toBe(true);
    expect(runClosed("failed")).toBe(true);
    expect(runClosed("canceled")).toBe(true);
    expect(runClosed("running")).toBe(false);
    expect(runClosed("pausing")).toBe(false);
    expect(runClosed("paused")).toBe(false);
    expect(runClosed("resuming")).toBe(false);
  });
});

describe("requestedHold", () => {
  const never: HoldRequestView = { submittedAt: 0, isSuccess: false, variables: undefined };
  const ok = (at: number, id: string): HoldRequestView => ({
    submittedAt: at,
    isSuccess: true,
    variables: id,
  });

  it("is the later accepted verb", () => {
    expect(requestedHold(ok(1, "t1"), never, "t1")).toBe("pause");
    expect(requestedHold(ok(1, "t1"), ok(2, "t1"), "t1")).toBe("resume");
    expect(requestedHold(ok(3, "t1"), ok(2, "t1"), "t1")).toBe("pause");
  });

  it("claims nothing while the request is in flight or was refused", () => {
    const pending: HoldRequestView = { submittedAt: 5, isSuccess: false, variables: "t1" };
    expect(requestedHold(pending, ok(2, "t1"), "t1")).toBeNull();
  });

  it("claims nothing about a different run", () => {
    expect(requestedHold(ok(1, "t1"), never, "t2")).toBeNull();
    expect(requestedHold(ok(1, "t1"), never, null)).toBeNull();
  });
});

describe("runElapsed", () => {
  it("measures between the start and the list's own clock", () => {
    expect(runElapsed("2026-09-18T09:44:30Z", "2026-09-18T09:45:00Z")).toBe("0:30");
  });

  it("is a dash, never NaN, when it cannot be measured", () => {
    expect(runElapsed("2026-09-18T09:44:30Z", null)).toBe("—");
    expect(runElapsed("not a time", "2026-09-18T09:45:00Z")).toBe("—");
  });
});
