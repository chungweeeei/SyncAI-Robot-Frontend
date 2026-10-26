// The steps the robot can take, as the task editor builds its menus and forms
// from them.
//
// What the robot can do is the backend's to say, so this is written as the
// contract a catalogue endpoint will answer with: every type, its operator
// label and hint, whether it occupies the robot's body (the group rule), and
// its parameters as a short list of field kinds the console knows how to
// draw. Until that endpoint exists the editor reads LOCAL_STEP_CATALOGUE
// through useStepCatalogue, and nothing in components/ imports it directly,
// so moving to the backend's answer is a change to that hook alone.
//
// A closed set of field kinds rather than JSON Schema: each kind is drawn
// with the care the hand-built rows had (a counter near a text limit, no
// type="number" erasing half-typed input), and the backend still validates,
// its refusals rendered verbatim.

import { z } from "zod";

import type { StepType } from "@/lib/api/task";
import {
  SPEAK_REPEAT_MAX,
  SPEAK_TEXT_MAX,
  STEP_TYPES,
  WAIT_SECONDS_MAX,
} from "@/lib/task/step";

/**
 * A waypoint on the job's map. On the wire it is not one key: it spreads into
 * `x / y / theta / z` and the template's `vertex_id`. A step with one is a
 * stop in the editor; see isStopSpec.
 */
export interface WaypointField {
  kind: "waypoint";
  key: string;
  label: string;
  /** "charger": only charging waypoints are offered. */
  filter?: "charger" | null;
}

export interface TextField {
  kind: "text";
  key: string;
  label: string;
  max_length: number;
  placeholder?: string | null;
}

export interface IntegerField {
  kind: "integer";
  key: string;
  label: string;
  min: number;
  max: number;
  /** The count a new step starts at; sent only when it differs. */
  default: number;
  /** What the count counts, after the field: "times". */
  unit?: string | null;
}

export interface NumberField {
  kind: "number";
  key: string;
  label: string;
  min: number;
  /** True when `min` itself is refused: a 0 s wait waits for nothing. */
  min_exclusive?: boolean;
  max: number;
  unit?: string | null;
  placeholder?: string | null;
}

export type StepParamField = WaypointField | TextField | IntegerField | NumberField;

export interface StepSpec {
  type: StepType;
  /** Operator words, as the add menus and each row name the step. */
  label: string;
  hint: string;
  /**
   * Moves the robot's body (walks, stands, lies). A group runs at most one,
   * which is how the editor decides what may start together.
   */
  occupies_body: boolean;
  params: StepParamField[];
}

export interface StepCatalogue {
  steps: StepSpec[];
}

const WaypointFieldSchema: z.ZodType<WaypointField> = z.object({
  kind: z.literal("waypoint"),
  key: z.string(),
  label: z.string(),
  filter: z.literal("charger").nullish(),
});

const TextFieldSchema: z.ZodType<TextField> = z.object({
  kind: z.literal("text"),
  key: z.string(),
  label: z.string(),
  max_length: z.number(),
  placeholder: z.string().nullish(),
});

const IntegerFieldSchema: z.ZodType<IntegerField> = z.object({
  kind: z.literal("integer"),
  key: z.string(),
  label: z.string(),
  min: z.number(),
  max: z.number(),
  default: z.number(),
  unit: z.string().nullish(),
});

const NumberFieldSchema: z.ZodType<NumberField> = z.object({
  kind: z.literal("number"),
  key: z.string(),
  label: z.string(),
  min: z.number(),
  min_exclusive: z.boolean().optional(),
  max: z.number(),
  unit: z.string().nullish(),
  placeholder: z.string().nullish(),
});

/** For the catalogue endpoint's answer, once there is one. */
export const StepCatalogueSchema: z.ZodType<StepCatalogue> = z.object({
  steps: z.array(
    z.object({
      type: z.enum(["MOVE", "DOCK", "SPEAK", "WAIT", "STANDUP", "LIEDOWN"]),
      label: z.string(),
      hint: z.string(),
      occupies_body: z.boolean(),
      params: z.array(
        z.union([WaypointFieldSchema, TextFieldSchema, IntegerFieldSchema, NumberFieldSchema]),
      ),
    }),
  ),
});

function spec(type: StepType, occupiesBody: boolean, params: StepParamField[]): StepSpec {
  const words = STEP_TYPES.find((each) => each.value === type);
  return {
    type,
    label: words?.label ?? type,
    hint: words?.hint ?? "",
    occupies_body: occupiesBody,
    params,
  };
}

/**
 * Today's six steps in the catalogue's shape. The limits are step.ts's, which
 * mirror the backend's validators; Speak's voice and speed are left out, as
 * the backend defaults them and the editor never sent them.
 */
export const LOCAL_STEP_CATALOGUE: StepCatalogue = {
  steps: [
    spec("MOVE", true, [{ kind: "waypoint", key: "target", label: "Waypoint" }]),
    spec("DOCK", true, [
      { kind: "waypoint", key: "target", label: "Charger", filter: "charger" },
    ]),
    spec("SPEAK", false, [
      {
        kind: "text",
        key: "text",
        label: "Say",
        max_length: SPEAK_TEXT_MAX,
        placeholder: "Delivery arrived — please take your items.",
      },
      {
        kind: "integer",
        key: "repeat",
        label: "Times",
        min: 1,
        max: SPEAK_REPEAT_MAX,
        default: 1,
        unit: "times",
      },
    ]),
    spec("WAIT", false, [
      {
        kind: "number",
        key: "seconds",
        label: "Duration",
        min: 0,
        min_exclusive: true,
        max: WAIT_SECONDS_MAX,
        unit: "seconds",
        placeholder: "10",
      },
    ]),
    spec("STANDUP", true, []),
    spec("LIEDOWN", true, []),
  ],
};

export function stepSpec(catalogue: StepCatalogue, type: StepType): StepSpec | null {
  return catalogue.steps.find((each) => each.type === type) ?? null;
}

/** A step set by a waypoint is a stop: the editor gives it a card of its own. */
export function isStopSpec(spec: StepSpec): boolean {
  return spec.params.some((field) => field.kind === "waypoint");
}

/** The steps done at or on the way to a stop, in catalogue order. */
export function actionSpecs(catalogue: StepCatalogue): StepSpec[] {
  return catalogue.steps.filter((each) => !isStopSpec(each));
}

/** The stops, in catalogue order: what a row of the map can be. */
export function stopSpecs(catalogue: StepCatalogue): StepSpec[] {
  return catalogue.steps.filter(isStopSpec);
}

/**
 * What may be done while walking to a stop: anything that leaves the body
 * free, since the walk already occupies it.
 */
export function transitSpecs(catalogue: StepCatalogue): StepSpec[] {
  return actionSpecs(catalogue).filter((each) => !each.occupies_body);
}
