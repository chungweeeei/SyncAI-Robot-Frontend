import { describe, expect, it } from "vitest";

import type { TemplateStep } from "@/lib/api/task-template";
import {
  SPEAK_TEXT_MAX,
  WAIT_SECONDS_MAX,
  formatDraftAngle,
  formatDraftPosition,
  fromTemplateSteps,
  moveStep,
  moveStepDraft,
  newStepDraft,
  repeatSuffix,
  stepDraftError,
  stepDraftsSubmittable,
  stepGroupError,
  stepGroupNames,
  stepGroupPlaces,
  stepIdFor,
  stepLinkProblem,
  stepMoveProblem,
  stepShape,
  stepSpans,
  stepSummary,
  stepWaypointOrdinals,
  toDispatchSteps,
  toStepRequests,
  toTemplateSteps,
  unlinkStep,
  wireLinked,
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
function wait(seconds: string): StepDraft {
  return { ...newStepDraft("WAIT"), seconds };
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

  it("refuses a MOVE with any non-numeric field, in words about waypoints", () => {
    // The composer shows no coordinate fields, so a sentence naming X, Y and
    // heading would point at inputs the operator cannot see; the only way to
    // fill a MOVE row there is to pick a waypoint.
    for (const over of [{ x: "" }, { y: "abc" }, { theta: "" }, { x: "1,5" }]) {
      expect(stepDraftError(move(over))).toBe("Pick a waypoint.");
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

  it("refuses a WAIT with no usable duration", () => {
    for (const seconds of ["", "  ", "abc", "1,5"]) {
      expect(stepDraftError(wait(seconds))).toBe("Needs a duration in seconds.");
    }
  });

  it("refuses a WAIT outside the backend's range, inclusive of the hour", () => {
    // gt=0, le=3600 in WaitParams: past either end the 422 is a validation
    // array, so the row has to say it first.
    expect(stepDraftError(wait("0"))).toBe("Needs a duration longer than 0 seconds.");
    expect(stepDraftError(wait("-5"))).toBe("Needs a duration longer than 0 seconds.");
    expect(stepDraftError(wait(String(WAIT_SECONDS_MAX + 1)))).toBe(
      `At most ${WAIT_SECONDS_MAX} seconds (1 hour).`,
    );
    expect(stepDraftError(wait(String(WAIT_SECONDS_MAX)))).toBeNull();
    expect(stepDraftError(wait("0.5"))).toBeNull();
  });

  it("has nothing to check on a posture step", () => {
    expect(stepDraftError(newStepDraft("STANDUP"))).toBeNull();
    expect(stepDraftError(newStepDraft("LIEDOWN"))).toBeNull();
  });
});

/**
 * A Speak said more than once. The count is the backend's `repeat`, bounded
 * 1–10 there; a line said once must stay the body it always was, so every
 * template and schedule from before the field reads the same.
 */
describe("a Speak's count", () => {
  const times = (repeat: string): StepDraft => ({ ...speak("Arrived"), repeat });

  it("says a new line once, and sends no count for it", () => {
    expect(newStepDraft("SPEAK").repeat).toBe("1");
    const [step] = toStepRequests([speak("Arrived")]);
    expect(step).toEqual({ id: "1-speak", type: "SPEAK", params: { text: "Arrived" } });
  });

  it("sends a count above once", () => {
    const [step] = toStepRequests([times("3")]);
    expect(step).toMatchObject({ params: { text: "Arrived", repeat: 3 } });
  });

  it("refuses anything but a whole 1 to 10, before the backend's 422", () => {
    for (const bad of ["", "0", "11", "2.5", "-1", "x"]) {
      expect(stepDraftError(times(bad))).toMatch(/1 to 10 times/);
    }
    expect(stepDraftError(times(" 10 "))).toBeNull();
  });

  it("round-trips through a saved template, and reads a missing one as once", () => {
    const saved = (params: { text: string; repeat?: number }): TemplateStep => ({
      id: "1-speak",
      type: "SPEAK",
      params,
      resolved_params: params,
      vertex_id: null,
      vertex_name: null,
      vertex_status: "NONE",
      group: null,
    });
    expect(fromTemplateSteps([saved({ text: "Hi", repeat: 4 })])[0]!.repeat).toBe("4");
    expect(fromTemplateSteps([saved({ text: "Hi" })])[0]!.repeat).toBe("1");
  });

  it("reads the count after the quote, and nothing for once", () => {
    expect(stepSummary(times("3"))).toBe("“Arrived” ×3");
    expect(stepSummary(times("1"))).toBe("“Arrived”");
    expect(repeatSuffix(undefined)).toBe("");
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

  it("reads a duration back in seconds, as typed", () => {
    expect(stepSummary(wait(" 2.50 "))).toBe("2.50 s");
    expect(stepSummary(newStepDraft("WAIT"))).toBeNull();
  });

  it("quotes a spoken line", () => {
    expect(stepSummary(speak(" Hello "))).toBe("“Hello”");
  });
});

describe("stepWaypointOrdinals", () => {
  it("lists every step that goes to a stop, by the number printed on its row", () => {
    // A patrol that returns to the dock: one marker, two numbers, in the
    // order the job runs them.
    const marks = stepWaypointOrdinals([
      move({ vertexId: "dock" }),
      move({ vertexId: "room" }),
      move({ vertexId: "dock" }),
    ]);
    expect(marks.get("dock")).toEqual([1, 3]);
    expect(marks.get("room")).toEqual([2]);
  });

  it("counts every row toward the ordinal but marks only picked MOVEs", () => {
    // The SPEAK is step 2 and the hand-edited MOVE is step 3; neither is a
    // stop on the map, and the pick after them is still step 4.
    const marks = stepWaypointOrdinals([
      move({ vertexId: "dock" }),
      speak("hi"),
      move({ vertexId: null }),
      move({ vertexId: "room" }),
    ]);
    expect([...marks.keys()]).toEqual(["dock", "room"]);
    expect(marks.get("room")).toEqual([4]);
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

  it("sends a WAIT's duration as the number of seconds", () => {
    const [step] = toStepRequests([wait(" 90 ")]);
    expect(step).toEqual({ id: "1-wait", type: "WAIT", params: { seconds: 90 } });
  });

  it("throws rather than dispatch a WAIT the backend would refuse", () => {
    expect(() => toStepRequests([wait("0")])).toThrow(/duration/);
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
    group: null,
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

  it("loads a WAIT's duration as text the field can hold", () => {
    const [draft] = fromTemplateSteps([
      stored({
        id: "1-wait",
        type: "WAIT",
        vertex_id: null,
        vertex_name: null,
        vertex_status: "NONE",
        params: { seconds: 12.5 },
        resolved_params: { seconds: 12.5 },
      }),
    ]);
    expect(draft.type).toBe("WAIT");
    expect(draft.seconds).toBe("12.5");
    expect(stepDraftError(draft)).toBeNull();
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

  it("throws rather than dispatch a WAIT with no duration", () => {
    expect(() =>
      toDispatchSteps([stored({ type: "WAIT", params: null, resolved_params: null })]),
    ).toThrow(/no duration/);
  });

  it("keeps a posture step free of params", () => {
    const steps = toDispatchSteps([
      stored({ type: "STANDUP", params: null, resolved_params: null }),
    ]);
    expect(steps).toEqual([{ id: "1-move", type: "STANDUP" }]);
  });
});

/**
 * Steps that start together. The composer stores a link on each row; the
 * backend wants a shared name on adjacent steps and refuses two body steps
 * in one group. Everything below is the translation between the two.
 */
describe("step groups", () => {
  const linked = (draft: StepDraft): StepDraft => ({ ...draft, withPrevious: true });

  it("names a chain of links as one group and leaves single rows unnamed", () => {
    const drafts = [move(), linked(speak("hi")), linked(wait("5")), newStepDraft("STANDUP")];
    expect(stepGroupPlaces(drafts)).toEqual(["start", "middle", "end", null]);
    expect(stepGroupNames(drafts)).toEqual(["g1", "g1", "g1", null]);
  });

  it("ignores a link on the first row, which has nothing above it", () => {
    expect(stepGroupNames([linked(speak("hi")), move()])).toEqual([null, null]);
  });

  it("sends a group only on the steps in one, so an ungrouped job is the body it was", () => {
    const [a, b, c] = toStepRequests([speak("a"), linked(move()), wait("1")]);
    expect(a).toMatchObject({ group: "g1" });
    expect(b).toMatchObject({ group: "g1" });
    expect(c).not.toHaveProperty("group");
    for (const step of toStepRequests([speak("a"), move()])) {
      expect(step).not.toHaveProperty("group");
    }
  });

  it("keeps the group beside a MOVE's vertex reference when saving", () => {
    const [, step] = toTemplateSteps([speak("a"), linked(move({ vertexId: "v-1" }))]);
    expect(step).toMatchObject({ group: "g1", vertex_id: "v-1" });
  });

  it("round-trips links through a saved template", () => {
    const saved: TemplateStep[] = [
      stored({ id: "1-move" }),
      stored({ id: "2-speak", type: "SPEAK", params: { text: "hi" }, resolved_params: { text: "hi" }, vertex_id: null, vertex_status: "NONE", group: "g2" }),
      stored({ id: "3-wait", type: "WAIT", params: { seconds: 2 }, resolved_params: { seconds: 2 }, vertex_id: null, vertex_status: "NONE", group: "g2" }),
    ];
    const drafts = fromTemplateSteps(saved);
    expect(drafts.map((draft) => draft.withPrevious)).toEqual([false, false, true]);
    expect(toTemplateSteps(drafts).map((step) => step.group ?? null)).toEqual([null, "g2", "g2"]);
  });

  it("dispatches a saved template's groups as stored", () => {
    const steps = toDispatchSteps([
      stored({ group: "a" }),
      stored({ id: "2-speak", type: "SPEAK", params: { text: "hi" }, resolved_params: { text: "hi" }, group: "a" }),
    ]);
    expect(steps.map((step) => step.group)).toEqual(["a", "a"]);
  });

  it("refuses a second Move, Stand or Lie in one group, on the later row", () => {
    // The robot has one body: the backend would answer 400.
    const drafts = [move(), linked(speak("hi")), linked(newStepDraft("STANDUP"))];
    expect(stepGroupError(drafts, 0)).toBeNull();
    expect(stepGroupError(drafts, 1)).toBeNull();
    expect(stepGroupError(drafts, 2)).toMatch(/one Move, Stand or Lie at a time/);
    expect(stepDraftsSubmittable(drafts)).toBe(false);
  });

  it("allows one body step beside any number of others, and body steps in turn", () => {
    expect(stepDraftsSubmittable([move(), linked(speak("hi")), linked(wait("3"))])).toBe(true);
    // Not linked: two Moves one after the other is an ordinary job.
    expect(stepDraftsSubmittable([move(), move()])).toBe(true);
    expect(stepDraftsSubmittable([move(), speak("x"), linked(move())])).toBe(true);
  });

  describe("unlinkStep", () => {
    it("keeps the rest of a group together when its middle leaves", () => {
      const drafts = [speak("a"), linked(speak("b")), linked(speak("c"))];
      const after = unlinkStep(drafts, 1).filter((_, index) => index !== 1);
      expect(stepGroupPlaces(after)).toEqual(["start", "end"]);
    });

    it("does not join the row below a departing head to whatever was above it", () => {
      const drafts = [move(), speak("a"), linked(speak("b"))];
      const after = unlinkStep(drafts, 1).filter((_, index) => index !== 1);
      expect(stepGroupPlaces(after)).toEqual([null, null]);
    });

    it("lands a moved row on its own", () => {
      const drafts = [speak("a"), linked(speak("b"))];
      expect(unlinkStep(drafts, 1)[1]!.withPrevious).toBe(false);
    });
  });

  it("cuts the list into the rows and boxes the editor draws", () => {
    const drafts = [move(), linked(speak("a")), wait("1"), speak("b"), linked(wait("2")), linked(move())];
    expect(stepSpans(drafts)).toEqual([
      { start: 0, end: 1 },
      { start: 2, end: 2 },
      { start: 3, end: 5 },
    ]);
    expect(stepSpans([])).toEqual([]);
  });

  describe("moveStepDraft", () => {
    // Labelled rows, so a result reads as the order and the boxes it draws.
    const row = (label: string, withPrevious = false): StepDraft => ({
      ...speak(label),
      withPrevious,
    });
    const shape = (drafts: StepDraft[]) =>
      stepSpans(drafts)
        .map(({ start, end }) => {
          const labels = drafts.slice(start, end + 1).map((draft) => draft.text);
          return start === end ? labels[0] : `[${labels.join(" ")}]`;
        })
        .join(" ");

    it("keeps a row reordered inside its own box in the box", () => {
      // The two-row box is the case a plain unlink-and-move broke apart.
      expect(shape(moveStepDraft([row("A"), row("B", true)], 1, 0))).toBe("[B A]");
      expect(shape(moveStepDraft([row("X"), row("A"), row("B", true), row("C", true)], 1, 3))).toBe(
        "X [B C A]",
      );
    });

    it("joins the box it lands inside, between two of its rows", () => {
      expect(shape(moveStepDraft([row("X"), row("A"), row("B", true)], 0, 1))).toBe("[A X B]");
      expect(shape(moveStepDraft([row("A"), row("B", true), row("X")], 2, 1))).toBe("[A X B]");
    });

    it("lands on its own on either edge of a box", () => {
      expect(shape(moveStepDraft([row("A"), row("B", true), row("X")], 2, 0))).toBe("X [A B]");
      expect(shape(moveStepDraft([row("X"), row("A"), row("B", true), row("Y")], 0, 2))).toBe(
        "[A B] X Y",
      );
    });

    it("leaves its box behind, keeping the rest of it together", () => {
      expect(
        shape(moveStepDraft([row("A"), row("B", true), row("C", true), row("X")], 1, 3)),
      ).toBe("[A C] X B");
    });

    it("does not link the row it pushes off the top", () => {
      // A link carried unread on the first row must not start to count at second.
      expect(shape(moveStepDraft([row("A", true), row("X")], 1, 0))).toBe("X A");
    });

    it("refuses to land a Move inside a box that already has one", () => {
      // [Move Speak] then a lone Move dropped between them: the box would
      // hold two body steps, so the list stays as it was.
      const drafts = [move(), linked(speak("a")), move()];
      expect(stepMoveProblem(drafts, 2, 1)).toMatch(/steps 1–2 already have one/);
      expect(moveStepDraft(drafts, 2, 1)).toEqual(drafts);
    });

    it("lets a Move into a box with none, and a Speak into any box", () => {
      const talk = [speak("a"), linked(speak("b")), move()];
      expect(stepMoveProblem(talk, 2, 1)).toBeNull();
      expect(stepGroupPlaces(moveStepDraft(talk, 2, 1))).toEqual(["start", "middle", "end"]);
      const busy = [move(), linked(speak("a")), speak("x")];
      expect(stepMoveProblem(busy, 2, 1)).toBeNull();
    });

    it("never refuses a reorder inside the row's own box", () => {
      const drafts = [move(), linked(speak("a")), linked(newStepDraft("STANDUP"))];
      expect(stepMoveProblem(drafts, 2, 0)).toBeNull();
    });
  });

  describe("stepLinkProblem", () => {
    it("refuses to start a body step together with one", () => {
      // Move with Stand, Move with Lie, Move with Move: the robot has one body.
      for (const type of ["MOVE", "STANDUP", "LIEDOWN"] as const) {
        expect(stepLinkProblem([move(), newStepDraft(type)], 1)).toMatch(
          /one Move, Stand or Lie at a time/,
        );
      }
    });

    it("judges the whole box on either side of the gap, not only the two rows", () => {
      // [Move Speak] above, [Speak Stand] below: the rows at the gap are two
      // Speaks, but the group it would make holds a Move and a Stand.
      const drafts = [move(), linked(speak("a")), speak("b"), linked(newStepDraft("STANDUP"))];
      expect(stepLinkProblem(drafts, 2)).not.toBeNull();
    });

    it("allows a link that brings at most one body step", () => {
      expect(stepLinkProblem([move(), speak("a")], 1)).toBeNull();
      expect(stepLinkProblem([speak("a"), wait("1")], 1)).toBeNull();
      // Nothing to judge on the first row, or on a link already made.
      expect(stepLinkProblem([move()], 0)).toBeNull();
      expect(stepLinkProblem([move(), linked(move())], 1)).toBeNull();
    });
  });

  it("reads links off wire steps by shared, adjacent names", () => {
    const steps = [{ group: null }, { group: "g2" }, { group: "g2" }, { group: undefined }];
    expect(steps.map((_, index) => wireLinked(steps, index))).toEqual([false, false, true, false]);
  });

  it("brackets the glyphs of steps that start together", () => {
    expect(
      stepShape([
        { type: "MOVE" },
        { type: "MOVE", group: "g2" },
        { type: "SPEAK", group: "g2" },
        { type: "STANDUP" },
      ]),
    ).toBe("M [M T] S");
  });
});
