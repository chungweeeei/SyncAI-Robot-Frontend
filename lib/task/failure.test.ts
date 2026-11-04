import { describe, expect, it } from "vitest";

import { stepFailureText } from "@/lib/task/failure";

/**
 * The rule: an operator reads one sentence in the console's words — never the
 * backend's wrapper, the planner's diagnostics or the word "keepout" — and a
 * sentence the console does not know is shown, not guessed at.
 */
describe("stepFailureText", () => {
  it("says a goal in a forbidden zone in one sentence, without the planner's detail", () => {
    expect(
      stepFailureText(
        "move ended in aborted: Planning failed: the goal is inside a keepout zone " +
          "(goal (2.10, 0.40) blocked; 12 traversable cells within the radius are in keepout zones)",
      ),
    ).toBe("The goal is inside a forbidden zone.");
  });

  it("reads a patrol's and a dock's failure the same as a move's", () => {
    for (const label of ["patrol", "dock", "undock"]) {
      expect(
        stepFailureText(
          `${label} ended in aborted: Planning failed: the robot stands inside a keepout zone (x)`,
        ),
      ).toBe("The robot is standing inside a forbidden zone.");
    }
  });

  it("does not take a sentence's own parentheses for the detail", () => {
    expect(
      stepFailureText(
        "move ended in aborted: Planning failed: no free ground at the goal " +
          "(a wall, a ledge, another floor, or an obstacle on it) (column dump)",
      ),
    ).toBe("There is no free ground at the goal.");
  });

  it("drops only the wrapper from a sentence it does not know", () => {
    expect(stepFailureText("move ended in aborted: Docking failed: the dock was not seen (x)")).toBe(
      "Docking failed: the dock was not seen (x)",
    );
    expect(stepFailureText("Goal is blocked.")).toBe("Goal is blocked.");
  });

  it("never names a step by its id", () => {
    expect(stepFailureText("Canceled: step 2-move failed")).toBe(
      "Canceled because a step beside it failed.",
    );
  });
});
