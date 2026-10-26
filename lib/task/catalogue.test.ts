import { describe, expect, it } from "vitest";

import type { StepType } from "@/lib/api/task";
import {
  LOCAL_STEP_CATALOGUE,
  StepCatalogueSchema,
  actionSpecs,
  isStopSpec,
  stepSpec,
  stopSpecs,
  transitSpecs,
} from "@/lib/task/catalogue";
import { isNavStep, stepOccupiesBody } from "@/lib/task/step";

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

  it("offers nothing that moves the body for the walk to a stop", () => {
    expect(transitSpecs(LOCAL_STEP_CATALOGUE).map((spec) => spec.type)).toEqual([
      "SPEAK",
      "WAIT",
    ]);
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
