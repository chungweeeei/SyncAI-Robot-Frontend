import { describe, expect, it } from "vitest";

import type { TemplateStep } from "@/lib/api/task-template";
import {
  SPEAK_TEXT_MAX,
  formatDraftAngle,
  formatDraftPosition,
  fromTemplateSteps,
  moveStep,
  newStepDraft,
  stepDraftError,
  stepDraftsSubmittable,
  stepIdFor,
  stepSummary,
  toDispatchSteps,
  toStepRequests,
  toTemplateSteps,
  type StepDraft,
} from "@/lib/task/step";

/**
 * The composer's draft model. Everything here guards the same boundary: a row
 * an operator half-filled must be refused *before* it becomes a request, since
 * the backend's answer for a bad step is a 422 whose detail is a validation
 * array rather than a sentence anyone can read.
 */
function move(over: Partial<StepDraft> = {}): StepDraft {
  return { ...newStepDraft("MOVE"), x: "1.5", y: "-2", theta: "90", ...over };
}
function speak(text: string): StepDraft {
  return { ...newStepDraft("SPEAK"), text };
}

describe("newStepDraft", () => {
  it("defaults the heading to 0 but never the position", () => {
    // Zero is a real, common heading; a position has no sensible default and
    // has to be supplied, so the field starts empty and the row starts invalid.
    const draft = newStepDraft("MOVE");
    expect(draft.theta).toBe("0");
    expect(draft.x).toBe("");
    expect(draft.y).toBe("");
    expect(stepDraftError(draft)).not.toBeNull();
  });

  it("gives every draft its own key", () => {
    const keys = [
      newStepDraft("MOVE").key,
      newStepDraft("MOVE").key,
      newStepDraft("SPEAK").key,
    ];
    expect(new Set(keys).size).toBe(3);
  });
});

describe("stepDraftError", () => {
  it("accepts a filled MOVE", () => {
    expect(stepDraftError(move())).toBeNull();
  });

  it("refuses a MOVE with any non-numeric field", () => {
    for (const over of [{ x: "" }, { y: "abc" }, { theta: "" }, { x: "1,5" }]) {
      expect(stepDraftError(move(over))).toBe(
        "Needs a numeric X, Y and heading.",
      );
    }
  });

  it("does not invent a heading range", () => {
    // 270 is a perfectly good way to say -90; normalizeTheta folds it on the
    // way out, so refusing it here would be a constraint nothing asked for.
    expect(stepDraftError(move({ theta: "270" }))).toBeNull();
    expect(stepDraftError(move({ theta: "-400" }))).toBeNull();
  });

  it("refuses a SPEAK with nothing to say, whitespace included", () => {
    expect(stepDraftError(speak(""))).toBe("Needs something to say.");
    expect(stepDraftError(speak("   "))).toBe("Needs something to say.");
  });

  it("refuses a SPEAK past the limit and counts it in the message", () => {
    const over = "a".repeat(SPEAK_TEXT_MAX + 1);
    expect(stepDraftError(speak(over))).toBe(
      `Too long — ${SPEAK_TEXT_MAX + 1} of ${SPEAK_TEXT_MAX} characters.`,
    );
    expect(stepDraftError(speak("a".repeat(SPEAK_TEXT_MAX)))).toBeNull();
  });

  it("has nothing to check on a posture step", () => {
    expect(stepDraftError(newStepDraft("STANDUP"))).toBeNull();
    expect(stepDraftError(newStepDraft("LIEDOWN"))).toBeNull();
  });
});

describe("stepDraftsSubmittable", () => {
  it("refuses the empty list", () => {
    // The backend accepts `steps: []` and reports COMPLETED having moved
    // nothing, which is worse than an error.
    expect(stepDraftsSubmittable([])).toBe(false);
  });

  it("needs every row, not just one", () => {
    expect(stepDraftsSubmittable([move(), newStepDraft("STANDUP")])).toBe(true);
    expect(stepDraftsSubmittable([move(), move({ x: "" })])).toBe(false);
  });
});

describe("stepSummary", () => {
  it("leads a MOVE with the waypoint it came from", () => {
    expect(stepSummary(move({ x: "2.5", y: "1.25", theta: "90" }), "dock")).toBe(
      "dock · (2.5, 1.25) · 90°",
    );
  });

  it("reads back what was typed, not a reformatted number", () => {
    // A folded row that rounded "2.500" to "2.5" would disagree with the field
    // the operator sees the moment they unfold it.
    expect(stepSummary(move({ x: " 2.500 ", y: "-0", theta: "0" }))).toBe(
      "(2.500, -0) · 0°",
    );
  });

  it("has nothing to say for an unfinished row or a bare posture", () => {
    expect(stepSummary(move({ x: "" }))).toBeNull();
    expect(stepSummary(newStepDraft("SPEAK"))).toBeNull();
    expect(stepSummary(newStepDraft("STANDUP"))).toBeNull();
  });

  it("quotes a spoken line", () => {
    expect(stepSummary(speak(" Hello "))).toBe("“Hello”");
  });
});

describe("moveStep", () => {
  const twenty = Array.from({ length: 20 }, (_, i) => i + 1);

  it("puts a far row first and shifts the rest down in order", () => {
    // The case the drag exists for: step 16 of 20 made the first thing run.
    // Every row in between keeps its relative order — this is an insert, not
    // the neighbour swap the old up/down buttons did.
    const moved = moveStep(twenty, 15, 0);
    expect(moved).toEqual([16, ...twenty.filter((n) => n !== 16)]);
  });

  it("moves a row to the end", () => {
    expect(moveStep([1, 2, 3, 4], 0, 3)).toEqual([2, 3, 4, 1]);
  });

  it("returns the same list for a drop where it started or out of range", () => {
    // Same reference, so a drag released on its own slot re-renders nothing.
    const list = [1, 2, 3];
    expect(moveStep(list, 1, 1)).toBe(list);
    expect(moveStep(list, -1, 0)).toBe(list);
    expect(moveStep(list, 0, 3)).toBe(list);
  });

  it("never mutates its input", () => {
    const list = [1, 2, 3];
    moveStep(list, 2, 0);
    expect(list).toEqual([1, 2, 3]);
  });
});

describe("stepIdFor", () => {
  it("numbers from the position in the list, not the draft key", () => {
    // A key-based id would call the third row `7-move` after two deletions.
    expect(stepIdFor(0, "MOVE")).toBe("1-move");
    expect(stepIdFor(2, "STANDUP")).toBe("3-standup");
  });
});

describe("toStepRequests", () => {
  it("folds the heading and trims the line on the way out", () => {
    const [moveStep, speakStep] = toStepRequests([
      move({ theta: "270" }),
      speak("  hello  "),
    ]);
    expect(moveStep).toEqual({
      id: "1-move",
      type: "MOVE",
      params: { x: 1.5, y: -2, theta: -90 },
    });
    expect(speakStep).toEqual({
      id: "2-speak",
      type: "SPEAK",
      params: { text: "hello" },
    });
  });

  it("gives a posture step no params key at all", () => {
    // `params` on a STANDUP is a 422 with a validation array in its detail, so
    // the discriminated union exists to make it unrepresentable.
    const [step] = toStepRequests([newStepDraft("STANDUP")]);
    expect(step).toEqual({ id: "1-standup", type: "STANDUP" });
    expect("params" in step).toBe(false);
  });

  it("sends no voice or speed, leaving the backend's defaults alone", () => {
    const [step] = toStepRequests([speak("hi")]);
    expect(step).toEqual({ id: "1-speak", type: "SPEAK", params: { text: "hi" } });
  });

  it("throws rather than dispatch a MOVE to the origin", () => {
    // Callers gate on stepDraftsSubmittable, so reaching here is a programming
    // error — and silently sending (0, 0) would drive a real robot there.
    expect(() => toStepRequests([move({ x: "" })])).toThrow(/coordinates/);
  });
});

describe("toTemplateSteps", () => {
  it("is toStepRequests plus the vertex reference on a MOVE", () => {
    const [step] = toTemplateSteps([move({ vertexId: "v-1" })]);
    expect(step).toMatchObject({
      id: "1-move",
      type: "MOVE",
      vertex_id: "v-1",
    });
  });

  it("carries a null reference for hand-typed coordinates", () => {
    const [step] = toTemplateSteps([move({ vertexId: null })]);
    expect((step as { vertex_id?: string | null }).vertex_id).toBeNull();
  });
});

describe("formatDraftPosition / formatDraftAngle", () => {
  it("rounds a raw double into something a 7-character field can hold", () => {
    expect(formatDraftPosition(6.8344510000000005)).toBe("6.834");
    expect(formatDraftAngle(90.17178865852111)).toBe("90.2");
  });

  it("drops the padding so zero reads as zero", () => {
    expect(formatDraftPosition(0)).toBe("0");
    expect(formatDraftAngle(0)).toBe("0");
    expect(formatDraftPosition(1.5)).toBe("1.5");
  });
});

/** A stored template step, as the backend reports one. */
function stored(over: Partial<TemplateStep> = {}): TemplateStep {
  return {
    id: "1-move",
    vertex_id: "v-1",
    vertex_name: "dock",
    vertex_status: "CURRENT",
    type: "MOVE",
    params: { x: 1, y: 1, theta: 0 },
    resolved_params: { x: 4.2, y: -3.7, theta: 45 },
    ...over,
  } as TemplateStep;
}

describe("fromTemplateSteps", () => {
  it("loads the vertex's current pose, not the saved snapshot", () => {
    // This is where a dock moved on the map shows up in the composer; using
    // `params` would display the stale snapshot and then dispatch something
    // else.
    const [draft] = fromTemplateSteps([stored()]);
    expect([draft.x, draft.y, draft.theta]).toEqual(["4.2", "-3.7", "45"]);
    expect(draft.vertexId).toBe("v-1");
    expect(draft.vertexMissing).toBe(false);
  });

  it("flags a step whose vertex was deleted", () => {
    const [draft] = fromTemplateSteps([stored({ vertex_status: "MISSING" })]);
    expect(draft.vertexMissing).toBe(true);
  });
});

describe("toDispatchSteps", () => {
  it("projects the resolved params and drops the provenance", () => {
    expect(toDispatchSteps([stored()])).toEqual([
      { id: "1-move", type: "MOVE", params: { x: 4.2, y: -3.7, theta: 45 } },
    ]);
  });

  it("throws rather than dispatch a MOVE the server could not resolve", () => {
    // Falling back to an origin would be a silent drive to (0, 0).
    expect(() =>
      toDispatchSteps([stored({ resolved_params: null })]),
    ).toThrow(/no coordinates/);
  });

  it("keeps a posture step free of params", () => {
    const steps = toDispatchSteps([
      stored({ type: "STANDUP", params: null, resolved_params: null }),
    ]);
    expect(steps).toEqual([{ id: "1-move", type: "STANDUP" }]);
  });
});
