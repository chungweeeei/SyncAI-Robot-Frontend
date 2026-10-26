import { describe, expect, it } from "vitest";

import type { StepType } from "@/lib/api/task";
import {
  actionLinkProblem,
  actionMoveTarget,
  addAction,
  duplicateAction,
  formatDuration,
  insertStop,
  jobSummary,
  moveAction,
  moveActionTo,
  moveStop,
  normalizeStops,
  removeAction,
  removeStop,
  sectionOf,
  sectionProblem,
  setTransit,
  stopLayout,
  stopOfRow,
  stopWaypointOrdinals,
} from "@/lib/task/stops";
import {
  newStepDraft,
  stepGroupError,
  stepGroupNames,
  type StepDraft,
} from "@/lib/task/step";

/**
 * The stop reading of the flat list. What these hold is that an edit made in
 * stops is still a list the backend runs the way the screen says: a stop
 * never lands between another stop and its actions, a walk never takes a
 * second body step, and reading a saved job as stops changes no step's
 * company.
 */

const names = new Map<number, string>();

/** A row named for the test: an upper-case name is a stop, lower-case an action. */
function row(name: string, type?: StepType, linked = false): StepDraft {
  const resolved: StepType =
    type ?? (name === name.toUpperCase() ? "MOVE" : "SPEAK");
  const draft = {
    ...newStepDraft(resolved),
    withPrevious: linked,
    vertexId: resolved === "MOVE" || resolved === "DOCK" ? `v-${name}` : null,
  };
  names.set(draft.key, name);
  return draft;
}

/** Each row by name, `&` for one that starts together with the row above. */
function shape(steps: readonly StepDraft[]): string[] {
  return steps.map((step) => `${step.withPrevious ? "&" : ""}${names.get(step.key) ?? "?"}`);
}

function keyOf(steps: readonly StepDraft[], name: string): number {
  return steps.find((step) => names.get(step.key) === name)!.key;
}

/** The patrol most tests start from: set off, two stops, actions at each. */
function patrol(): StepDraft[] {
  return [
    row("stand", "STANDUP"),
    row("A"),
    row("excuse", "SPEAK", true),
    row("hello"),
    row("pause", "WAIT"),
    row("B"),
    row("bye"),
  ];
}

/** Whether every group in the list is one the backend accepts. */
function groupsValid(steps: readonly StepDraft[]): boolean {
  return steps.every((_, index) => stepGroupError(steps, index) === null);
}

describe("stopLayout", () => {
  it("reads rows before the first stop, each stop's walk and its arrival", () => {
    const steps = patrol();
    const layout = stopLayout(steps);
    expect(layout.startEnd).toBe(1);
    expect(layout.stops).toEqual([
      { key: keyOf(steps, "A"), index: 1, transitEnd: 3, end: 5 },
      { key: keyOf(steps, "B"), index: 5, transitEnd: 6, end: 7 },
    ]);
  });

  it("reads a job with no stop as all before setting off", () => {
    const steps = [row("hi"), row("pause", "WAIT")];
    expect(stopLayout(steps)).toEqual({ startEnd: 2, stops: [] });
  });

  it("puts a box of actions on arrival, not on the walk", () => {
    const steps = [row("A"), row("lie", "LIEDOWN"), row("night", "SPEAK", true)];
    expect(sectionOf(steps, keyOf(steps, "night"))).toEqual({
      kind: "arrival",
      stop: keyOf(steps, "A"),
    });
  });
});

describe("normalizeStops", () => {
  it("leaves a list that already reads as stops untouched, as the same array", () => {
    const steps = patrol();
    expect(normalizeStops(steps)).toBe(steps);
  });

  // [Speak, Move] and [Move, Speak] start together alike: the reorder must
  // keep every row in the company it had.
  it("starts a group with its stop, keeping who starts with whom", () => {
    const steps = [row("hi"), row("excuse", "SPEAK", true), row("A", "MOVE", true), row("bye")];
    const normalized = normalizeStops(steps);
    expect(shape(normalized)).toEqual(["A", "&hi", "&excuse", "bye"]);
    const groupOf = (list: StepDraft[]) => {
      const groups = stepGroupNames(list);
      return (name: string) => groups[list.findIndex((step) => names.get(step.key) === name)];
    };
    const after = groupOf(normalized);
    expect(after("hi")).toBe(after("A"));
    expect(after("excuse")).toBe(after("A"));
    expect(after("bye")).toBeNull();
  });

  it("unlinks a second body step an old draft put in one group", () => {
    const steps = [row("A"), row("hi", "SPEAK", true), row("B", "MOVE", true)];
    const normalized = normalizeStops(steps);
    expect(shape(normalized)).toEqual(["A", "&hi", "B"]);
    expect(groupsValid(normalized)).toBe(true);
  });

  it("drops a link on the first row, which has nothing to start with", () => {
    expect(shape(normalizeStops([row("hi", "SPEAK", true)]))).toEqual(["hi"]);
  });
});

describe("insertStop", () => {
  it("adds after a stop and everything done there, never inside it", () => {
    const steps = patrol();
    const next = insertStop(steps, keyOf(steps, "A"), row("C"));
    expect(shape(next)).toEqual(["stand", "A", "&excuse", "hello", "pause", "C", "B", "bye"]);
  });

  it("adds ahead of the first stop from before setting off, and at the end from nothing", () => {
    const steps = patrol();
    expect(shape(insertStop(steps, "start", row("C")))[1]).toBe("C");
    expect(shape(insertStop(steps, null, row("D"))).at(-1)).toBe("D");
  });

  it("never joins the new stop to the row above", () => {
    const steps = [row("A"), row("excuse", "SPEAK", true)];
    const next = insertStop(steps, keyOf(steps, "A"), row("B", "MOVE", true));
    expect(shape(next)).toEqual(["A", "&excuse", "B"]);
  });
});

describe("addAction", () => {
  it("adds to the end of a stop's arrival, on its own", () => {
    const steps = patrol();
    const next = addAction(steps, { kind: "arrival", stop: keyOf(steps, "A") }, row("look"));
    expect(shape(next)).toEqual(["stand", "A", "&excuse", "hello", "pause", "look", "B", "bye"]);
  });

  it("adds to the walk as starting together with it", () => {
    const steps = patrol();
    const next = addAction(steps, { kind: "transit", stop: keyOf(steps, "B") }, row("beep"));
    expect(shape(next)).toEqual(["stand", "A", "&excuse", "hello", "pause", "B", "&beep", "bye"]);
  });

  it("adds before setting off ahead of the first stop", () => {
    const steps = patrol();
    expect(shape(addAction(steps, { kind: "start" }, row("hi")))).toEqual([
      "stand",
      "hi",
      "A",
      "&excuse",
      "hello",
      "pause",
      "B",
      "bye",
    ]);
  });

  // The walk occupies the body; a Stand on it is the backend's 400.
  it("refuses a body step on the walk, and a stop as an action", () => {
    const steps = patrol();
    const walk = { kind: "transit", stop: keyOf(steps, "A") } as const;
    expect(sectionProblem(walk, { type: "LIEDOWN" })).not.toBeNull();
    expect(shape(addAction(steps, walk, row("lie", "LIEDOWN")))).toEqual(shape(steps));
    expect(sectionProblem({ kind: "start" }, { type: "MOVE" })).not.toBeNull();
  });
});

describe("stops as blocks", () => {
  it("removes a stop with its walk and its arrival", () => {
    const steps = patrol();
    expect(shape(removeStop(steps, keyOf(steps, "A")))).toEqual(["stand", "B", "bye"]);
  });

  it("moves a stop with everything done there, leaving what is done before setting off first", () => {
    const steps = patrol();
    const next = moveStop(steps, keyOf(steps, "B"), 0);
    expect(shape(next)).toEqual(["stand", "B", "bye", "A", "&excuse", "hello", "pause"]);
    expect(groupsValid(next)).toBe(true);
  });
});

describe("actions", () => {
  it("moves along its section, and across to the next arrival at the edge", () => {
    const steps = patrol();
    const pause = keyOf(steps, "pause");
    expect(shape(moveAction(steps, pause, "up"))).toEqual([
      "stand",
      "A",
      "&excuse",
      "pause",
      "hello",
      "B",
      "bye",
    ]);
    // Down from the last row of A's arrival lands first in B's.
    expect(shape(moveAction(steps, pause, "down"))).toEqual([
      "stand",
      "A",
      "&excuse",
      "hello",
      "B",
      "pause",
      "bye",
    ]);
  });

  it("moves from the first stop's arrival up to before setting off", () => {
    const steps = patrol();
    expect(shape(moveAction(steps, keyOf(steps, "hello"), "up"))).toEqual([
      "stand",
      "hello",
      "A",
      "&excuse",
      "pause",
      "B",
      "bye",
    ]);
  });

  it("has nowhere to go past the ends, or off a walk's edge", () => {
    const steps = patrol();
    expect(actionMoveTarget(steps, keyOf(steps, "stand"), "up")).toBeNull();
    expect(actionMoveTarget(steps, keyOf(steps, "bye"), "down")).toBeNull();
    expect(actionMoveTarget(steps, keyOf(steps, "excuse"), "up")).toBeNull();
  });

  it("drags only within its own section", () => {
    const steps = patrol();
    const hello = keyOf(steps, "hello");
    expect(shape(moveActionTo(steps, hello, 4))).toEqual([
      "stand",
      "A",
      "&excuse",
      "pause",
      "hello",
      "B",
      "bye",
    ]);
    expect(shape(moveActionTo(steps, hello, 6))).toEqual(shape(steps));
  });

  it("moves onto the walk and back to the head of the arrival", () => {
    const steps = patrol();
    const onWalk = setTransit(steps, keyOf(steps, "pause"), true);
    expect(shape(onWalk)).toEqual(["stand", "A", "&excuse", "&pause", "hello", "B", "bye"]);
    const back = setTransit(onWalk, keyOf(steps, "excuse"), false);
    expect(shape(back)).toEqual(["stand", "A", "&pause", "excuse", "hello", "B", "bye"]);
  });

  it("keeps a body step and anything before setting off off the walk", () => {
    const steps = [row("A"), row("lie", "LIEDOWN"), row("B")];
    expect(shape(setTransit(steps, keyOf(steps, "lie"), true))).toEqual(shape(steps));
    const early = [row("hi"), row("A")];
    expect(shape(setTransit(early, keyOf(early, "hi"), true))).toEqual(shape(early));
  });

  it("links only within its section", () => {
    const steps = patrol();
    expect(actionLinkProblem(steps, keyOf(steps, "pause"))).toBeNull();
    // First on arrival: linking would put it on the walk.
    expect(actionLinkProblem(steps, keyOf(steps, "hello"))).not.toBeNull();
    expect(actionLinkProblem(steps, keyOf(steps, "excuse"))).not.toBeNull();
  });

  it("removes one action and copies one after its box", () => {
    const steps = [row("A"), row("lie", "LIEDOWN"), row("night", "SPEAK", true), row("bye")];
    expect(shape(removeAction(steps, keyOf(steps, "lie")))).toEqual(["A", "night", "bye"]);
    const copied = duplicateAction(steps, keyOf(steps, "lie"));
    expect(copied.map((step) => step.type)).toEqual(["MOVE", "LIEDOWN", "SPEAK", "LIEDOWN", "SPEAK"]);
    expect(copied[3]!.withPrevious).toBe(false);
  });
});

describe("stopOfRow", () => {
  it("answers the stop a row belongs to, or before setting off", () => {
    const steps = patrol();
    const a = keyOf(steps, "A");
    expect(stopOfRow(steps, a)).toBe(a);
    expect(stopOfRow(steps, keyOf(steps, "excuse"))).toBe(a);
    expect(stopOfRow(steps, keyOf(steps, "pause"))).toBe(a);
    expect(stopOfRow(steps, keyOf(steps, "stand"))).toBe("start");
    expect(stopOfRow(steps, -1)).toBeNull();
  });
});

describe("stopWaypointOrdinals", () => {
  it("numbers the stops, not the rows, and lists a waypoint visited twice", () => {
    const steps = [row("stand", "STANDUP"), row("A"), row("hi"), row("B"), row("A2")];
    steps[4] = { ...steps[4]!, vertexId: "v-A" };
    expect(stopWaypointOrdinals(steps)).toEqual(
      new Map([
        ["v-A", [1, 3]],
        ["v-B", [2]],
      ]),
    );
  });
});

describe("jobSummary", () => {
  it("counts the stops, sums the waits, and says where the job ends", () => {
    const steps = [
      row("A"),
      { ...row("pause", "WAIT"), seconds: "30" },
      { ...row("half", "WAIT"), seconds: "1." },
      row("C", "DOCK"),
      { ...row("rest", "WAIT"), seconds: "60" },
    ];
    expect(jobSummary(steps, (id) => (id === "v-C" ? "Charger" : null))).toEqual({
      stops: 2,
      waitSeconds: 91,
      end: { name: "Charger", dock: true },
    });
  });

  it("has no end for a job that never sets off", () => {
    expect(jobSummary([row("hi")], () => null)).toEqual({ stops: 0, waitSeconds: 0, end: null });
  });
});

describe("formatDuration", () => {
  it("reads in the largest units that matter", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(2.5)).toBe("2.5 s");
    expect(formatDuration(90)).toBe("1 min 30 s");
    expect(formatDuration(120)).toBe("2 min");
    expect(formatDuration(3900)).toBe("1 h 5 min");
  });
});
