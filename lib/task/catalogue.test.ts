import { describe, expect, it } from "vitest";

import type { StepType } from "@/lib/api/task";
import {
  LOCAL_STEP_CATALOGUE,
  StepCatalogueSchema,
  actionSpecs,
  isStopSpec,
  stepLimits,
  stepSpec,
  stopSpecs,
  transitSpecs,
} from "@/lib/task/catalogue";
import {
  DEFAULT_STEP_LIMITS,
  isNavStep,
  newStepDraft,
  stepDraftError,
  stepOccupiesBody,
} from "@/lib/task/step";

const ALL_TYPES: StepType[] = ["MOVE", "DOCK", "SPEAK", "WAIT", "STANDUP", "LIEDOWN"];

describe("the local step catalogue", () => {
  it("describes every step type the backend takes", () => {
    for (const type of ALL_TYPES) expect(stepSpec(LOCAL_STEP_CATALOGUE, type)).not.toBeNull();
  });

  // The editor builds its groups from the catalogue and step.ts checks them:
  // two answers to "may these start together" would let a save through that
  // the backend refuses, or refuse one it takes.
  it("agrees with the rules the drafts are checked against", () => {
    for (const spec of LOCAL_STEP_CATALOGUE.steps) {
      expect(spec.occupies_body, spec.type).toBe(stepOccupiesBody(spec.type));
      expect(isStopSpec(spec), spec.type).toBe(isNavStep(spec));
    }
  });

  // A Wait in the walk's group only makes the walk last at least that long.
  it("offers speech alone for the walk, never a body step or a Wait", () => {
    expect(transitSpecs(LOCAL_STEP_CATALOGUE).map((spec) => spec.type)).toEqual(["SPEAK"]);
  });

  it("keeps a body step off the walk even when an answer offers it there", () => {
    const claims = {
      steps: LOCAL_STEP_CATALOGUE.steps.map((spec) => ({ ...spec, while_walking: true })),
    };
    expect(transitSpecs(claims).map((spec) => spec.type)).toEqual(["SPEAK", "WAIT"]);
  });

  it("splits the steps into stops and what is done at them", () => {
    expect(stopSpecs(LOCAL_STEP_CATALOGUE).map((spec) => spec.type)).toEqual(["MOVE", "DOCK"]);
    expect(actionSpecs(LOCAL_STEP_CATALOGUE).map((spec) => spec.type)).toEqual([
      "SPEAK",
      "WAIT",
      "STANDUP",
      "LIEDOWN",
    ]);
  });

  it("is the shape the endpoint's schema reads, and a field the backend adds is not a break", () => {
    const answer = {
      steps: LOCAL_STEP_CATALOGUE.steps.map((spec) => ({ ...spec, since: "2.4" })),
    };
    expect(StepCatalogueSchema.parse(answer)).toEqual(LOCAL_STEP_CATALOGUE);
  });
});

describe("the robot's catalogue", () => {
  // A robot updated before its console: the new step is left out of the
  // menus, and the steps this console can draw still are.
  it("leaves out a step this console cannot draw instead of failing the answer", () => {
    const answer = {
      steps: [
        ...LOCAL_STEP_CATALOGUE.steps,
        { type: "SCAN_QR", label: "Scan code", hint: "", occupies_body: false, params: [] },
        {
          ...LOCAL_STEP_CATALOGUE.steps[2],
          type: "SPEAK",
          params: [{ kind: "colour", key: "led", label: "LED" }],
        },
      ],
    };
    expect(StepCatalogueSchema.parse(answer)).toEqual(LOCAL_STEP_CATALOGUE);
  });

  it("still refuses an answer that is not a catalogue at all", () => {
    expect(StepCatalogueSchema.safeParse({ step: [] }).success).toBe(false);
  });

  // The robot's bounds are the ones its validators apply; holding a draft
  // to the console's own would refuse what the robot takes.
  it("holds a draft to the robot's bounds", () => {
    const shorter = {
      steps: LOCAL_STEP_CATALOGUE.steps.map((spec) =>
        spec.type === "WAIT"
          ? { ...spec, params: spec.params.map((field) => ({ ...field, max: 600 })) }
          : spec,
      ),
    };
    const limits = stepLimits(shorter);
    expect(limits).toEqual({ ...DEFAULT_STEP_LIMITS, waitSecondsMax: 600 });
    const wait = { ...newStepDraft("WAIT"), seconds: "900" };
    expect(stepDraftError(wait)).toBeNull();
    expect(stepDraftError(wait, limits)).toBe("At most 600 seconds (10 min).");
  });

  it("keeps the local bound for a field the robot does not describe", () => {
    expect(stepLimits({ steps: [] })).toEqual(DEFAULT_STEP_LIMITS);
  });
});
